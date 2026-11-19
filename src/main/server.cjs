// OpenBench — engine lifecycle + REST/SSE client.
//
// Supports two engine generations:
//   v2 (opencode 2.x, the TokenCode engine): `serve --service`, Basic auth from service.json, routes under /api
//   v1 (upstream opencode-ai 1.x): `serve`, no auth, routes at the root
// Mode is detected once at startup and reused for every request.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const START_TIMEOUT_MS = 25000;
const SERVICE_WAIT_MS = 20000;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function quoteWindows(arg) {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

class BenchServer extends EventEmitter {
  constructor({ resolveCli, userData, cwd }) {
    super();
    this.resolveCli = resolveCli;
    this.userData = userData;
    this.cwd = cwd;
    this.portOverride = 0;
    this.proc = null;
    this.baseUrl = null;
    this.serviceFile = null;
    this.auth = null;
    this.mode = null;
    this.state = "stopped";
    this.lastError = null;
    this.cli = null;
    this.eventAbort = null;
    this.log = [];
  }

  status() {
    return {
      state: this.state,
      url: this.baseUrl,
      cli: this.cli,
      mode: this.mode,
      error: this.lastError,
      log: this.log.slice(-40),
    };
  }

  pushLog(line) {
    const clean = String(line).trim();
    if (!clean) return;
    this.log.push(clean);
    if (this.log.length > 300) this.log.shift();
  }

  spawnCli(cli, args, env) {
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(cli)) {
      return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", [cli, ...args].map(quoteWindows).join(" ")], {
        env,
        cwd: this.cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    return spawn(cli, args, { env, cwd: this.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  }

  servicePaths() {
    const relative = path.join("opencode", "service.json");
    const roots = [];
    if (process.env.XDG_CONFIG_HOME) roots.push(path.join(process.env.XDG_CONFIG_HOME, relative));
    if (process.env.XDG_STATE_HOME) roots.push(path.join(process.env.XDG_STATE_HOME, relative));
    roots.push(path.join(this.userData, relative));
    return roots;
  }

  /** The engine writes {id,url,pid,password} after binding. Poll until the pid matches ours. */
  async waitServiceFile(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const candidate of this.servicePaths()) {
        try {
          const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
          if (!parsed.password) continue;
          if (this.proc && parsed.pid && parsed.pid !== this.proc.pid) continue;
          this.serviceFile = candidate;
          this.auth = "Basic " + Buffer.from(`opencode:${parsed.password}`).toString("base64");
          return true;
        } catch {
          // not written yet
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }

  headers(extra) {
    return { ...(this.auth ? { authorization: this.auth } : {}), ...(extra || {}) };
  }

  href(route) {
    return `${this.baseUrl}${this.mode === "v2" ? "/api" : ""}${route}`;
  }

  async probe(url, headers) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
      return response.status;
    } catch {
      return 0;
    }
  }

  async detectMode() {
    const v2 = await this.probe(`${this.baseUrl}/api/session`, this.headers({ accept: "application/json" }));
    if (v2 === 200 || v2 === 401) {
      this.mode = "v2";
      if (!this.auth) await this.waitServiceFile(SERVICE_WAIT_MS);
      const retry = await this.probe(`${this.baseUrl}/api/session`, this.headers({ accept: "application/json" }));
      return retry === 200;
    }
    const v1 = await this.probe(`${this.baseUrl}/session`, { accept: "application/json" });
    if (v1 === 200) {
      this.mode = "v1";
      return true;
    }
    return false;
  }

  async launch({ service }) {
    const port = this.portOverride > 0 ? this.portOverride : await freePort();
    this.baseUrl = `http://127.0.0.1:${port}`;
    const env = { ...process.env };
    delete env.OPENCODE_CONFIG_CONTENT;

    const args = ["serve"];
    if (service) args.push("--service");
    args.push("--hostname", "127.0.0.1", `--port=${port}`);

    const proc = this.spawnCli(this.cli, args, env);
    this.proc = proc;
    let listening = false;

    const started = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("engine produced no output in time")), START_TIMEOUT_MS);
      const onData = (chunk) => {
        this.pushLog(chunk.toString());
        listening = true;
        clearTimeout(timer);
        resolve();
      };
      proc.stdout.on("data", onData);
      proc.stderr.on("data", onData);
      proc.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      proc.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`engine exited early (${code})`));
      });
    });

    proc.once("exit", (code, signal) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.eventAbort?.abort();
      if (this.state !== "stopped") {
        this.state = "error";
        this.lastError = `server exited (${signal || code})`;
        this.emit("status", this.status());
      }
    });

    try {
      await started;
    } catch (error) {
      this.pushLog(`startup: ${error.message}; probing HTTP anyway`);
    }
    void listening;
    return proc;
  }

  async start() {
    if (this.state === "running" || this.state === "starting") return this.status();
    this.state = "starting";
    this.lastError = null;
    this.mode = null;
    this.auth = null;
    this.serviceFile = null;
    this.emit("status", this.status());

    const cli = this.resolveCli();
    if (!cli) {
      this.state = "error";
      this.lastError = "OpenCode CLI not found. Set the CLI path in Settings or install opencode-ai.";
      this.emit("status", this.status());
      throw new Error(this.lastError);
    }
    this.cli = cli;

    try {
      await this.launch({ service: true });
      if (!(await this.detectMode())) {
        // Older builds reject --service; retry as a plain server.
        this.pushLog("v2 shape not found — retrying without --service");
        await this.killProc();
        await this.launch({ service: false });
        if (!(await this.detectMode())) throw new Error("engine did not answer a known route shape");
      }
      this.state = "running";
      this.emit("status", this.status());
      this.consumeEvents();
      return this.status();
    } catch (error) {
      this.lastError = error.message;
      this.state = "error";
      await this.killProc();
      this.emit("status", this.status());
      throw error;
    }
  }

  async killProc() {
    const proc = this.proc;
    this.proc = null;
    if (!proc) return;
    proc.kill();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2500);
      proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async stop() {
    this.state = "stopped";
    this.eventAbort?.abort();
    this.eventAbort = null;
    this.emit("status", this.status());
    await this.killProc();
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  async request(method, route, body, { timeout = 120000 } = {}) {
    if (this.state !== "running") throw new Error("OpenCode server is not running");
    const response = await fetch(this.href(route), {
      method,
      headers: this.headers(body === undefined ? undefined : { "content-type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      const reason =
        data && typeof data === "object"
          ? data.message || data.error?.message || JSON.stringify(data).slice(0, 400)
          : String(data || "").slice(0, 400);
      const error = new Error(`${method} ${route} -> HTTP ${response.status}${reason ? `: ${reason}` : ""}`);
      error.status = response.status;
      throw error;
    }
    // v2 wraps every payload as { location, data }
    if (this.mode === "v2" && data && typeof data === "object" && !Array.isArray(data) && "data" in data) {
      return data.data;
    }
    return data;
  }

  consumeEvents() {
    this.eventAbort?.abort();
    const controller = new AbortController();
    this.eventAbort = controller;
    this.readEvents(controller.signal).catch((error) => {
      if (!controller.signal.aborted) this.pushLog(`event stream: ${error.message}`);
    });
  }

  async readEvents(signal) {
    let backoff = 1000;
    while (!signal.aborted && this.state === "running") {
      try {
        const response = await fetch(this.href("/event"), {
          headers: this.headers({ accept: "text/event-stream" }),
          signal,
        });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        backoff = 1000;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let split;
          while ((split = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, split).replace(/\r$/, "");
            buffer = buffer.slice(split + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload);
              // v2 frames are { id, type, data }; v1 frames are { type, properties }.
              this.emit("event", parsed.data && !parsed.properties ? { ...parsed.data, type: parsed.type } : parsed);
            } catch {
              this.pushLog("event stream: unparsable frame");
            }
          }
        }
      } catch (error) {
        if (signal.aborted) return;
        this.pushLog(`event stream retry: ${error.message}`);
      }
      if (signal.aborted || this.state !== "running") return;
      await new Promise((resolve) => setTimeout(resolve, backoff));
      backoff = Math.min(backoff * 2, 15000);
    }
  }
}

module.exports = { BenchServer, freePort };
