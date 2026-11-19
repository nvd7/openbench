// OpenBench — bundled Tor sidecar.
//
// Tor exposes three listeners here:
//   19050  SOCKS5      (for tools that speak SOCKS directly)
//   19051  control     (AUTHENTICATE / SIGNAL NEWNYM, used to rotate circuits)
//   18118  HTTP tunnel (CONNECT proxy the engine can use through HTTPS_PROXY)
//
// The engine gets 18118 because HTTP proxies need no protocol shim. Circuit rotation
// is NEWNYM, which only affects *new* streams — an in-flight model request keeps its
// circuit until it finishes.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const SOCKS_PORT = 19050;
const CONTROL_PORT = 19051;
const HTTP_PORT = 18118;

let child = null;

function portOpen(port, host = "127.0.0.1", timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** Candidate tor binaries: explicit setting, TokenCode's sidecar, then PATH. */
function resolveTor(settings) {
  const candidates = [];
  if (settings?.torPath) candidates.push(settings.torPath);

  const packages = path.join(process.env.LOCALAPPDATA || "", "TokenCode", "packages");
  try {
    for (const entry of fs.readdirSync(packages, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      candidates.push(path.join(packages, entry.name, "app", "resources", "tor", "tor.exe"));
    }
  } catch {
    // no TokenCode install on this machine
  }

  for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(dir.replace(/^"|"$/g, ""), "tor.exe"));
  }

  for (const candidate of candidates) {
    try {
      if (candidate && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

async function running() {
  return portOpen(CONTROL_PORT);
}

async function start({ userData, settings, timeoutMs = 45000 }) {
  if (await running()) return { started: false, already: true, proxy: `http://127.0.0.1:${HTTP_PORT}` };

  const bin = resolveTor(settings);
  if (!bin) throw new Error("tor.exe not found (set it in Settings, or install Tor)");

  const dataDir = path.join(userData, "tor", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const torrc = path.join(userData, "tor", "torrc");
  fs.writeFileSync(
    torrc,
    [
      `SocksPort ${SOCKS_PORT}`,
      `ControlPort ${CONTROL_PORT}`,
      `HTTPTunnelPort ${HTTP_PORT}`,
      `DataDirectory ${dataDir}`,
      "CookieAuthentication 0",
      "Log notice file " + path.join(userData, "tor", "tor.log"),
    ].join("\n") + "\n",
  );

  child = spawn(bin, ["-f", torrc], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.resume();
  child.stderr.resume();
  child.once("exit", () => {
    child = null;
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(CONTROL_PORT)) {
      return { started: true, already: false, proxy: `http://127.0.0.1:${HTTP_PORT}` };
    }
    if (!child) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("tor did not open its control port in time");
}

/** Send a control command and resolve with whatever tor answers. */
function control(command) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port: CONTROL_PORT, host: "127.0.0.1" });
    let buffer = "";
    socket.setTimeout(4000, () => {
      socket.destroy();
      reject(new Error(`tor control timeout on ${command}`));
    });
    socket.once("connect", () => {
      // No cookie set in torrc: bare AUTHENTICATE is accepted.
      socket.write("AUTHENTICATE\r\n");
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (/^250 OK/m.test(buffer)) {
        if (!command) {
          socket.end();
          resolve(buffer);
          return;
        }
        socket.write(`${command}\r\n`);
        command = "";
        buffer = "";
        return;
      }
      if (/^5\d\d /m.test(buffer)) {
        socket.destroy();
        reject(new Error(`tor control: ${buffer.trim()}`));
      }
    });
    socket.once("error", reject);
  });
}

async function rotate() {
  if (!(await running())) throw new Error("tor is not running");
  await control("SIGNAL NEWNYM");
  return true;
}

async function stop() {
  if (child) {
    child.kill();
    child = null;
  }
}

module.exports = { start, stop, rotate, running, resolveTor, portOpen, SOCKS_PORT, CONTROL_PORT, HTTP_PORT };
