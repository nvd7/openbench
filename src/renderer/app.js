/* OpenBench renderer — vanilla JS, no remote code. Engine API v2 first, v1 shaped by main. */
(() => {
  "use strict";

  const bench = window.bench;
  const state = {
    settings: null,
    info: null,
    status: { state: "stopped", url: null, error: null },
    sessions: [],
    sessionID: null,
    messages: [],
    models: [],
    providers: [],
    model: null,
    streaming: false,
    filter: "",
    catalog: [],
    skills: [],
    refreshTimer: null,
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  /* ---------------- utils ---------------- */

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toast(message, kind = "") {
    const stack = $("#toast-stack");
    const node = document.createElement("div");
    node.className = `toast ${kind}`;
    node.textContent = message;
    stack.appendChild(node);
    setTimeout(() => node.remove(), 5200);
  }

  function formatTime(ms) {
    if (!ms) return "";
    const value = ms > 1e12 ? ms : ms * 1000;
    try {
      return new Date(value).toLocaleString();
    } catch {
      return "";
    }
  }

  function shortNumber(value) {
    const number = Number(value || 0);
    if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
    if (number >= 1000) return `${(number / 1000).toFixed(1)}k`;
    return String(number);
  }

  function debounce(fn, ms) {
    let handle = null;
    return (...args) => {
      clearTimeout(handle);
      handle = setTimeout(() => fn(...args), ms);
    };
  }

  /* ---------------- markdown ---------------- */

  function renderInline(source) {
    return String(source)
      .split(/(`[^`\n]+`)/g)
      .map((chunk) => {
        if (chunk.length > 2 && chunk.startsWith("`") && chunk.endsWith("`")) {
          return `<code>${escapeHtml(chunk.slice(1, -1))}</code>`;
        }
        return escapeHtml(chunk)
          .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
          .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
          .replace(/\[([^\]]+)\]\((https?:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
      })
      .join("");
  }

  function renderBlocks(source) {
    const lines = String(source).replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let paragraph = [];
    let list = null;

    const flushParagraph = () => {
      if (!paragraph.length) return;
      out.push(`<p>${renderInline(paragraph.join("\n")).replace(/\n/g, "<br />")}</p>`);
      paragraph = [];
    };
    const flushList = () => {
      if (!list) return;
      out.push(`<${list.tag}>${list.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${list.tag}>`);
      list = null;
    };
    const flush = () => {
      flushParagraph();
      flushList();
    };

    for (const line of lines) {
      if (!line.trim()) {
        flush();
        continue;
      }
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        flush();
        const level = Math.min(6, heading[1].length + 2);
        out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        continue;
      }
      const unordered = line.match(/^\s*[-*]\s+(.*)$/);
      if (unordered) {
        flushParagraph();
        if (!list || list.tag !== "ul") {
          flushList();
          list = { tag: "ul", items: [] };
        }
        list.items.push(unordered[1]);
        continue;
      }
      const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
      if (ordered) {
        flushParagraph();
        if (!list || list.tag !== "ol") {
          flushList();
          list = { tag: "ol", items: [] };
        }
        list.items.push(ordered[1]);
        continue;
      }
      const quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        flush();
        out.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
        continue;
      }
      flushList();
      paragraph.push(line);
    }
    flush();
    return out.join("");
  }

  function renderMarkdown(source) {
    const text = String(source || "");
    const fence = /```([\w+#.-]*)[ \t]*\r?\n([\s\S]*?)```/g;
    let html = "";
    let cursor = 0;
    let match;
    while ((match = fence.exec(text))) {
      html += renderBlocks(text.slice(cursor, match.index));
      html += `<pre><code>${escapeHtml(match[2])}</code></pre>`;
      cursor = fence.lastIndex;
    }
    return (html + renderBlocks(text.slice(cursor))) || "<p></p>";
  }

  /* ---------------- normalisation ---------------- */

  // Engine messages: { id, time, type, agent, model, content: [parts] }
  function normaliseMessage(raw) {
    const parts = Array.isArray(raw.content) ? raw.content : Array.isArray(raw.parts) ? raw.parts : [];
    return {
      id: raw.id,
      role: raw.type === "user" ? "user" : raw.type === "assistant" ? "assistant" : raw.role || "assistant",
      time: raw.time || {},
      modelID: raw.model?.modelID || raw.model?.id || raw.modelID || "",
      providerID: raw.model?.providerID || raw.providerID || "",
      tokens: raw.tokens || null,
      cost: raw.cost || 0,
      error: raw.error || null,
      parts,
    };
  }

  function normaliseSession(raw) {
    return {
      id: raw.id,
      title: raw.title || "untitled session",
      time: { created: raw.time?.created || 0, updated: raw.time?.updated || raw.time?.created || 0 },
    };
  }

  /* ---------------- rendering ---------------- */

  function currentSession() {
    return state.sessions.find((session) => session.id === state.sessionID) || null;
  }

  function renderSessions() {
    const container = $("#session-list");
    container.innerHTML = "";
    const filter = state.filter.toLowerCase();
    const sessions = state.sessions
      .filter((s) => !filter || s.title.toLowerCase().includes(filter) || s.id.includes(filter))
      .slice()
      .sort((a, b) => (b.time.updated || 0) - (a.time.updated || 0));

    if (!sessions.length) {
      const empty = document.createElement("div");
      empty.className = "sidebar-empty";
      empty.textContent = state.sessions.length ? "no match" : "no sessions yet";
      container.appendChild(empty);
      return;
    }

    for (const session of sessions) {
      const item = document.createElement("div");
      item.className = `session-item${session.id === state.sessionID ? " active" : ""}`;

      const title = document.createElement("span");
      title.className = "title";
      title.textContent = session.title;
      title.title = `${session.title}\n${formatTime(session.time.updated)}`;

      const remove = document.createElement("button");
      remove.className = "delete";
      remove.type = "button";
      remove.textContent = "✕";
      remove.title = "Delete session";
      remove.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (!confirm("Delete this session?")) return;
        try {
          await bench.sessions.remove(session.id);
          if (session.id === state.sessionID) {
            state.sessionID = null;
            state.messages = [];
          }
          await loadSessions();
          render();
        } catch (error) {
          toast(error.message || String(error), "error");
        }
      });

      item.addEventListener("click", () => selectSession(session.id));
      item.append(title, remove);
      container.appendChild(item);
    }
  }

  function renderPart(part) {
    const node = document.createElement("div");

    if (part.type === "text") {
      node.innerHTML = renderMarkdown(part.text || "");
      return node;
    }

    if (part.type === "reasoning") {
      if (!String(part.text || "").trim()) return null;
      const details = document.createElement("details");
      details.className = "part-reasoning";
      const summary = document.createElement("summary");
      const start = part.time?.created || part.time?.start;
      summary.textContent = start ? `reasoning · ${Math.max(1, Math.round((Date.now() - start) / 1000))}s` : "reasoning";
      const body = document.createElement("div");
      body.textContent = part.text;
      details.append(summary, body);
      return details;
    }

    if (part.type === "tool") {
      const details = document.createElement("details");
      details.className = "part-tool";
      const summary = document.createElement("summary");
      const name = document.createElement("span");
      name.className = "tool-name";
      name.textContent = part.name || part.tool || "tool";
      const status = document.createElement("span");
      status.className = "tool-state";
      status.textContent = part.state?.status || "pending";
      summary.append(name, status);

      const body = document.createElement("div");
      body.className = "tool-body";
      const chunks = [];
      const input = part.state?.input;
      const output = part.state?.output;
      if (input && Object.keys(input).length) chunks.push(`→ ${JSON.stringify(input, null, 2)}`);
      if (output) chunks.push(`← ${typeof output === "string" ? output : JSON.stringify(output, null, 2)}`);
      if (part.state?.error) chunks.push(`! ${part.state.error}`);
      body.textContent = chunks.join("\n\n") || "no payload";
      details.append(summary, body);
      return details;
    }

    return null;
  }

  function renderMessage(message) {
    const wrap = document.createElement("div");
    wrap.className = `msg ${message.role}`;
    wrap.dataset.messageID = message.id;

    const avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    avatar.textContent = message.role === "user" ? "You" : "AI";

    const body = document.createElement("div");
    body.className = "msg-body";

    const roleLine = document.createElement("div");
    roleLine.className = "msg-role";
    roleLine.textContent = message.role;
    if (message.role === "assistant" && message.modelID) {
      const meta = document.createElement("span");
      meta.className = "msg-meta";
      const tokens = message.tokens
        ? ` · ${shortNumber(message.tokens.input)} in / ${shortNumber(message.tokens.output)} out`
        : "";
      meta.textContent = `${message.providerID}/${message.modelID}${tokens}`;
      roleLine.appendChild(meta);
    }
    body.appendChild(roleLine);

    const content = document.createElement("div");
    content.className = "msg-content";

    let rendered = 0;
    for (const part of message.parts) {
      const node = renderPart(part);
      if (node) {
        content.appendChild(node);
        rendered += 1;
      }
    }

    if (!rendered && message.role === "assistant" && state.streaming) {
      content.innerHTML = '<span class="streaming-cursor"></span>';
    }
    if (message.error) {
      const error = document.createElement("div");
      error.className = "msg-error";
      error.textContent = message.error.data?.message || message.error.message || message.error.name || "request failed";
      content.appendChild(error);
    }

    body.appendChild(content);
    wrap.append(avatar, body);
    return wrap;
  }

  function renderMessages({ forceScroll = false } = {}) {
    const container = $("#messages");
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 140;
    container.innerHTML = "";

    if (!state.sessionID) {
      const template = document.querySelector("#empty-template");
      if (template) container.appendChild(template.content.cloneNode(true));
      bindSuggestions();
      return;
    }

    const visible = state.messages.filter((message) => message.role === "user" || message.role === "assistant");
    if (!visible.length) {
      const empty = document.createElement("section");
      empty.className = "empty-state";
      empty.innerHTML = "<h2>Session ready</h2><p>Send the first task below.</p>";
      container.appendChild(empty);
      bindSuggestions();
      return;
    }

    for (const message of visible) container.appendChild(renderMessage(message));
    if (nearBottom || forceScroll) container.scrollTop = container.scrollHeight;
    bindSuggestions();
  }

  function bindSuggestions() {
    $$("#messages .suggestions button").forEach((button) => {
      button.onclick = () => {
        $("#prompt").value = button.dataset.suggestion || "";
        $("#prompt").focus();
      };
    });
  }

  function render() {
    renderSessions();
    renderMessages();
    const session = currentSession();
    $("#session-title").textContent = session ? session.title : "Start a session";

    if (session) {
      const tokens = state.messages.reduce(
        (sum, message) => sum + Number(message.tokens?.input || 0) + Number(message.tokens?.output || 0),
        0,
      );
      $("#session-meta").textContent = [formatTime(session.time.updated), tokens ? `${shortNumber(tokens)} tokens` : ""]
        .filter(Boolean)
        .join(" · ");
    } else {
      $("#session-meta").textContent = "";
    }

    $("#composer-hint").textContent = state.streaming
      ? "streaming…"
      : state.status.state === "running"
        ? "ready"
        : "server offline";
    $("#stop-button").hidden = !state.streaming;
  }

  /* ---------------- models ---------------- */

  function modelLabel() {
    if (!state.model) return "default model";
    return `${state.model.providerName} · ${state.model.name}`;
  }

  function renderModelButton() {
    $("#model-button").textContent = modelLabel();
  }

  function buildModelIndex(models, providers) {
    const providerNames = new Map((providers || []).map((provider) => [provider.id, provider.name || provider.id]));
    state.models = (models || []).map((model) => ({
      providerID: model.providerID,
      providerName: providerNames.get(model.providerID) || model.providerID,
      modelID: model.modelID || model.id,
      name: model.name || model.modelID || model.id,
    }));
    const saved = state.settings?.model;
    state.model =
      state.models.find((item) => item.providerID === saved?.providerID && item.modelID === saved?.modelID) ||
      state.model ||
      state.models[0] ||
      null;
    renderModelButton();
    renderModelList();
  }

  function renderModelList() {
    const container = $("#model-list");
    const query = ($("#model-search").value || "").toLowerCase();
    container.innerHTML = "";

    const groups = new Map();
    for (const model of state.models.filter((item) =>
      `${item.providerName} ${item.name} ${item.modelID}`.toLowerCase().includes(query),
    )) {
      if (!groups.has(model.providerID)) groups.set(model.providerID, []);
      groups.get(model.providerID).push(model);
    }

    if (!groups.size) {
      container.innerHTML = '<div class="sidebar-empty">no models — check providers</div>';
      return;
    }

    for (const [providerID, models] of groups) {
      const header = document.createElement("div");
      header.className = "model-group";
      header.textContent = models[0].providerName || providerID;
      container.appendChild(header);

      for (const model of models) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `model-item${
          state.model && state.model.providerID === model.providerID && state.model.modelID === model.modelID
            ? " active"
            : ""
        }`;
        const name = document.createElement("span");
        name.textContent = model.name;
        const id = document.createElement("span");
        id.className = "model-id";
        id.textContent = model.modelID;
        button.append(name, id);
        button.onclick = async () => {
          state.model = model;
          renderModelButton();
          renderModelList();
          $("#model-overlay").hidden = true;
          try {
            state.settings = await bench.settings.patch({ model: { providerID: model.providerID, modelID: model.modelID } });
          } catch {
            // persistence is best effort
          }
        };
        container.appendChild(button);
      }
    }
  }

  /* ---------------- data loading ---------------- */

  async function loadSessions() {
    try {
      const sessions = await bench.sessions.list();
      state.sessions = (Array.isArray(sessions) ? sessions : []).map(normaliseSession);
    } catch (error) {
      state.sessions = [];
      if (state.status.state === "running") toast(`sessions: ${error.message}`, "error");
    }
    renderSessions();
  }

  async function loadMessages() {
    if (!state.sessionID) {
      state.messages = [];
      renderMessages();
      return;
    }
    try {
      const messages = await bench.sessions.messages(state.sessionID);
      state.messages = (Array.isArray(messages) ? messages : []).map(normaliseMessage);
      state.streaming = state.messages.some(
        (message) => message.role === "assistant" && !message.time?.completed && state.streaming,
      );
      render();
    } catch (error) {
      if (state.status.state === "running") toast(`messages: ${error.message}`, "error");
    }
  }

  async function selectSession(id) {
    state.sessionID = id;
    state.messages = [];
    state.streaming = false;
    renderSessions();
    $("#session-title").textContent = "loading…";
    await loadMessages();
  }

  async function ensureSession() {
    if (state.sessionID) return state.sessionID;
    const session = await bench.sessions.create({ title: "" });
    state.sessionID = session.id;
    state.sessions.unshift(normaliseSession(session));
    renderSessions();
    return session.id;
  }

  async function refreshEngineMeta() {
    try {
      const [models, providers] = await Promise.all([bench.engine.models(), bench.engine.providers()]);
      state.providers = Array.isArray(providers) ? providers : [];
      buildModelIndex(Array.isArray(models) ? models : [], state.providers);
    } catch (error) {
      toast(`engine: ${error.message}`, "error");
    }
  }

  /* ---------------- events ---------------- */

  function handleServerStatus(status) {
    const previous = state.status.state;
    state.status = status || state.status;
    const pill = $("#server-pill");
    pill.dataset.state = state.status.state || "stopped";
    pill.textContent = state.status.state === "running" ? "online" : state.status.state;
    pill.title = [state.status.url, state.status.mode, state.status.error].filter(Boolean).join(" · ");

    if (state.status.state === "running") {
      if (previous !== "running") {
        refreshEngineMeta();
        loadSessions();
      }
      if (state.sessionID) loadMessages();
    }
    render();
  }

  function scheduleRefresh(delay = 400) {
    if (state.refreshTimer) return;
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null;
      loadMessages().catch(() => {});
    }, delay);
  }

  function handleEvent(event) {
    if (!event || !event.type) return;
    const type = String(event.type);

    if (type === "session.idle" || type === "session.error") {
      state.streaming = false;
      loadMessages();
      loadSessions();
      return;
    }
    if (type.startsWith("message.") || type.startsWith("part.")) {
      scheduleRefresh(350);
      return;
    }
    if (type.startsWith("session.")) {
      loadSessions();
    }
  }

  /* ---------------- composer ---------------- */

  function autosize(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(220, textarea.scrollHeight)}px`;
  }

  async function sendPrompt(text) {
    const prompt = String(text || "").trim();
    if (!prompt) return;
    if (state.status.state !== "running") {
      toast("server is offline — start it in Settings", "error");
      return;
    }
    try {
      const sessionID = await ensureSession();
      const body = { text: prompt };
      if (state.model) body.model = { providerID: state.model.providerID, modelID: state.model.modelID };
      state.streaming = true;
      $("#prompt").value = "";
      autosize($("#prompt"));
      render();
      await bench.sessions.prompt(sessionID, body);
      scheduleRefresh(200);
    } catch (error) {
      state.streaming = false;
      render();
      toast(error.message || String(error), "error");
    }
  }

  async function abortPrompt() {
    if (!state.sessionID) return;
    try {
      await bench.sessions.abort(state.sessionID);
      state.streaming = false;
      render();
    } catch (error) {
      toast(error.message || String(error), "error");
    }
  }

  /* ---------------- settings ---------------- */

  async function fillAbout() {
    const info = state.info || (await bench.info());
    state.info = info;
    $("#about-info").innerHTML = [
      ["version", info.version],
      ["electron", info.electron],
      ["node", info.node],
      ["platform", info.platform],
      ["config", info.configFile],
      ["user data", info.userData],
      ["engine", state.status.url || "stopped"],
      ["mode", state.status.mode || "unknown"],
    ]
      .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
      .join("");
  }

  async function fillGeneral() {
    $("#setting-theme").value = state.settings.theme || "sombra";
    $("#setting-cli").value = state.settings.cliPath || "";
    $("#setting-port").value = state.settings.port ?? 0;
    $("#setting-directory").value = state.settings.directory || "";
    await fillAbout();
  }

  async function saveGeneral() {
    try {
      state.settings = await bench.settings.patch({
        theme: $("#setting-theme").value,
        cliPath: $("#setting-cli").value.trim(),
        port: Number($("#setting-port").value) || 0,
        directory: $("#setting-directory").value.trim(),
        lastDirectory: $("#setting-directory").value.trim(),
      });
      applyTheme();
      toast("saved — restarting engine", "ok");
      await bench.server.restart();
    } catch (error) {
      toast(error.message || String(error), "error");
    }
  }

  async function loadProvidersPanel() {
    const list = $("#provider-list");
    list.innerHTML = "";
    try {
      const custom = await bench.providers.list();
      if (!custom.length) {
        list.innerHTML = '<div class="sidebar-empty">no custom providers</div>';
        return;
      }
      for (const provider of custom) {
        const item = document.createElement("div");
        item.className = "list-item";
        item.innerHTML = `<span class="grow"><span class="name">${escapeHtml(provider.name)}</span><span class="sub">${escapeHtml(
          provider.id,
        )} · ${escapeHtml(provider.protocol || provider.npm)} · ${provider.models.length} models</span></span>`;
        const edit = document.createElement("button");
        edit.type = "button";
        edit.textContent = "edit";
        edit.onclick = () => fillProviderForm(provider);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "danger";
        remove.textContent = "✕";
        remove.onclick = async () => {
          if (!confirm(`Remove provider ${provider.id}?`)) return;
          try {
            await bench.providers.remove(provider.id);
            await loadProvidersPanel();
            toast("removed — restart the engine", "ok");
          } catch (error) {
            toast(error.message || String(error), "error");
          }
        };
        item.append(edit, remove);
        list.appendChild(item);
      }
    } catch (error) {
      list.innerHTML = `<div class="sidebar-empty">${escapeHtml(error.message)}</div>`;
    }
  }

  function fillProviderForm(provider) {
    const form = $("#provider-form");
    form.elements.id.value = provider.id || "";
    form.elements.name.value = provider.name || "";
    form.elements.protocol.value = provider.protocol || "openai-chat";
    form.elements.baseURL.value = provider.baseURL || "";
    form.elements.apiKey.value = "";
    form.elements.models.value = (provider.models || []).join("\n");
  }

  async function submitProvider(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const result = await bench.providers.save({
        id: form.elements.id.value.trim(),
        name: form.elements.name.value.trim(),
        protocol: form.elements.protocol.value,
        baseURL: form.elements.baseURL.value.trim(),
        apiKey: form.elements.apiKey.value,
        models: form.elements.models.value.split(/\s*\n\s*/).filter(Boolean),
      });
      toast(`saved ${result.provider.id} — restart the engine`, "ok");
      await loadProvidersPanel();
    } catch (error) {
      toast(error.message || String(error), "error");
    }
  }

  async function loadMcpPanel() {
    const list = $("#mcp-list");
    list.innerHTML = "";
    try {
      const configured = await bench.mcp.list();
      let live = [];
      if (state.status.state === "running") {
        live = (await bench.engine.mcp().catch(() => [])) || [];
      }
      const liveByName = new Map((Array.isArray(live) ? live : []).map((entry) => [entry.name || entry.id, entry.status || entry.state]));

      if (!configured.length) {
        list.innerHTML = '<div class="sidebar-empty">no MCP servers</div>';
        return;
      }
      for (const entry of configured) {
        const status = liveByName.get(entry.name);
        const item = document.createElement("div");
        item.className = "list-item";
        item.innerHTML = `<span class="grow"><span class="name">${escapeHtml(entry.name)}</span><span class="sub">${escapeHtml(
          entry.type,
        )} · ${escapeHtml(entry.type === "local" ? (entry.command || []).join(" ") : entry.url || "")}</span></span>${
          status ? `<span class="badge">${escapeHtml(String(status))}</span>` : ""
        }`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "danger";
        remove.textContent = "✕";
        remove.onclick = async () => {
          if (!confirm(`Remove MCP ${entry.name}?`)) return;
          try {
            await bench.mcp.remove(entry.name);
            await loadMcpPanel();
            toast("removed — restart the engine", "ok");
          } catch (error) {
            toast(error.message || String(error), "error");
          }
        };
        item.appendChild(remove);
        list.appendChild(item);
      }
    } catch (error) {
      list.innerHTML = `<div class="sidebar-empty">${escapeHtml(error.message)}</div>`;
    }
  }

  async function submitMcp(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const type = form.elements.type.value;
    const value =
      type === "local"
        ? { type, command: form.elements.command.value.trim().split(/\s+/).filter(Boolean), enabled: form.elements.enabled.checked }
        : { type, url: form.elements.url.value.trim(), enabled: form.elements.enabled.checked };
    try {
      await bench.mcp.save(form.elements.name.value.trim(), value);
      toast("saved — restart the engine", "ok");
      await loadMcpPanel();
    } catch (error) {
      toast(error.message || String(error), "error");
    }
  }

  async function loadSkills() {
    const list = $("#skill-list");
    list.innerHTML = "";
    try {
      const fromDisk = await bench.skills.list();
      let fromEngine = [];
      if (state.status.state === "running") fromEngine = (await bench.engine.skills().catch(() => [])) || [];

      const seen = new Set();
      const merged = [];
      for (const skill of fromDisk) {
        const key = skill.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push({ name: skill.name, id: skill.id, description: skill.description, path: skill.path });
      }
      for (const skill of Array.isArray(fromEngine) ? fromEngine : []) {
        const name = skill.name || skill.id;
        if (seen.has(String(name).toLowerCase())) continue;
        seen.add(String(name).toLowerCase());
        merged.push({ name, id: skill.id || skill.name, description: skill.description || "", path: "" });
      }

      if (!merged.length) {
        list.innerHTML = '<div class="sidebar-empty">no skills found</div>';
        return;
      }
      for (const skill of merged) {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `<div class="card-title"><span>${escapeHtml(skill.name)}</span><span class="badge">${escapeHtml(
          skill.id,
        )}</span></div><div class="card-sub">${escapeHtml(skill.description || skill.path || "")}</div>`;
        list.appendChild(card);
      }
    } catch (error) {
      list.innerHTML = `<div class="sidebar-empty">${escapeHtml(error.message)}</div>`;
    }
  }

  async function loadCatalog() {
    const list = $("#catalog-list");
    list.innerHTML = "";
    try {
      state.catalog = await bench.catalog.list($("#catalog-search").value || "");
      if (!state.catalog.length) {
        list.innerHTML = '<div class="sidebar-empty">no matching tools</div>';
        return;
      }
      for (const tool of state.catalog) {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `<div class="card-title"><span>${escapeHtml(tool.id)}</span><span class="badge ${
          tool.cloned ? "ok" : ""
        }">${tool.cloned ? "cloned" : escapeHtml(tool.category)}</span></div><div class="card-sub">${escapeHtml(
          tool.description || "",
        )}</div>`;
        const actions = document.createElement("div");
        actions.className = "card-actions";
        const action = document.createElement("button");
        action.type = "button";
        action.className = "btn btn-ghost";
        action.textContent = tool.cloned ? "Reveal folder" : "Clone";
        action.onclick = async () => {
          try {
            if (tool.cloned) {
              await bench.shell.reveal(tool.directory);
              return;
            }
            action.disabled = true;
            action.textContent = "cloning…";
            await bench.catalog.clone(tool.id);
            toast(`${tool.id} cloned`, "ok");
            await loadCatalog();
          } catch (error) {
            action.disabled = false;
            action.textContent = "Clone";
            toast(error.message || String(error), "error");
          }
        };
        actions.appendChild(action);
        card.appendChild(actions);
        list.appendChild(card);
      }
    } catch (error) {
      list.innerHTML = `<div class="sidebar-empty">${escapeHtml(error.message)}</div>`;
    }
  }

  /* ---------------- settings: auto-jb ---------------- */

  async function loadAutojb() {
    const status = $("#autojb-status");
    try {
      const meta = await bench.autojb.get();
      $("autojb-enabled").value = meta.enabled ? "on" : "off";
      $("autojb-compaction").value = meta.compactionAuto ? "on" : "off";
      $("autojb-text").value = meta.customText || "";
      $("autojb-badge").textContent = meta.enabled ? "active" : "off";
      $("autojb-badge").className = `badge${meta.enabled ? " ok" : ""}`;
      status.textContent = [
        meta.usingCustomText ? "custom brief" : "shipped default",
        `${meta.textLength} chars`,
        meta.compactionAuto ? "auto compaction on" : "auto compaction off",
        meta.instructionsFile,
      ].join(" · ");
    } catch (error) {
      status.textContent = error.message || String(error);
    }
  }

  async function saveAutojb() {
    const status = $("autojb-status");
    try {
      status.textContent = "saving…";
      await bench.autojb.save({
        enabled: $("autojb-enabled").value === "on",
        compactionAuto: $("autojb-compaction").value === "on",
        customText: $("autojb-text").value,
      });
      await loadAutojb();
      toast("saved — restarting engine", "ok");
      await bench.server.restart();
      status.textContent = `${status.textContent} — engine restarted`;
    } catch (error) {
      status.textContent = error.message || String(error);
      toast(error.message || String(error), "error");
    }
  }

  /* ---------------- settings: instruction profiles ---------------- */

  let profilesCache = null;

  function profileTarget() {
    const scope = $("#profiles-scope").value;
    const value = $("#profiles-target").value.trim();
    if (scope === "project") return { directory: value };
    if (scope === "session") return { sessionID: value };
    return {};
  }

  function renderProfiles(info) {
    profilesCache = info;
    const select = $("#profiles-select");
    const keep = select.value;
    select.innerHTML = '<option value="">new profile...</option>';
    for (const profile of info.profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = `${profile.name} (${profile.length.toLocaleString()} chars)`;
      select.appendChild(option);
    }
    if (keep) select.value = keep;

    const lines = [];
    lines.push(`file:      ${info.file}`);
    lines.push(`profiles:  ${info.profiles.length}/${info.limits.profiles}`);
    lines.push(`default:   ${info.defaultID || "(none)"}`);
    for (const [dir, id] of Object.entries(info.projects)) {
      const name = info.profiles.find((p) => p.id === id)?.name || id;
      lines.push(`project:   ${dir} -> ${name}`);
    }
    for (const [session, id] of Object.entries(info.sessions)) {
      const name = info.profiles.find((p) => p.id === id)?.name || id;
      lines.push(`session:   ${session} -> ${name}`);
    }
    $("#profiles-info").textContent = lines.join("\n");
    const badge = $("#profiles-badge");
    badge.textContent = info.profiles.length ? `${info.profiles.length} saved` : "empty";
    badge.className = `badge${info.profiles.length ? " ok" : ""}`;
  }

  async function loadProfiles() {
    try {
      renderProfiles(await bench.profiles.summary());
    } catch (error) {
      $("#profiles-info").textContent = error.message || String(error);
    }
  }

  function selectProfile() {
    const id = $("#profiles-select").value;
    const profile = profilesCache?.profiles?.find((entry) => entry.id === id);
    $("#profiles-name").value = profile?.name || "";
    $("#profiles-content").value = "";
    if (id) {
      bench.profiles
        .read(id)
        .then((value) => {
          $("#profiles-content").value = value?.content || "";
        })
        .catch(() => {});
    }
  }

  async function saveProfile() {
    try {
      const saved = await bench.profiles.save({
        id: $("#profiles-select").value || undefined,
        name: $("#profiles-name").value,
        content: $("#profiles-content").value,
      });
      toast("profile saved", "ok");
      await loadProfiles();
      $("#profiles-select").value = saved.id;
      selectProfile();
    } catch (error) {
      toast(error.message || String(error), "error");
    }
  }

  async function deleteProfile() {
    const id = $("#profiles-select").value;
    if (!id) return;
    if (!confirm("Delete this profile and every binding to it?")) return;
    try {
      await bench.profiles.remove(id);
      $("#profiles-select").value = "";
      $("#profiles-name").value = "";
      $("#profiles-content").value = "";
      await loadProfiles();
    } catch (error) {
      toast(error.message || String(error), "error");
    }
  }

  async function bindProfile(unbind) {
    const id = $("#profiles-select").value;
    if (!unbind && !id) {
      toast("pick a profile first", "error");
      return;
    }
    try {
      await bench.profiles.bind({ id: unbind ? "" : id, scope: profileTarget() });
      toast(unbind ? "binding removed" : "profile bound", "ok");
      await loadProfiles();
    } catch (error) {
      toast(error.message || String(error), "error");
    }
  }

  async function pickProfileScope() {
    const directory = await bench.dialog.directory();
    if (!directory) return;
    $("#profiles-scope").value = "project";
    $("#profiles-target").value = directory;
  }

  /* ---------------- settings: context policy ---------------- */

  function fillPolicyOptions() {
    const threshold = $("#context-threshold");
    const windowSelect = $("#context-window");
    if (threshold.options.length) return;
    for (const value of [25, 50, 65, 75, 80, 95]) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = `${value}%`;
      threshold.appendChild(option);
    }
    for (const value of [25, 50, 75, 100]) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = `${value}%`;
      windowSelect.appendChild(option);
    }
  }

  function renderPolicies(info) {
    fillPolicyOptions();
    const lines = [`file: ${info.file}`];
    lines.push(`defaults: auto=${info.defaults.auto} threshold=${info.defaults.threshold}% window=${info.defaults.window}%`);
    const entries = Object.entries(info.sessions || {});
    if (!entries.length) lines.push("sessions: (none - defaults apply)");
    for (const [session, policy] of entries) {
      lines.push(`${session}: auto=${policy.auto} threshold=${policy.threshold}% window=${policy.window}%`);
    }
    $("#context-info").textContent = lines.join("\n");
    const badge = $("#context-badge");
    badge.textContent = `${entries.length} session${entries.length === 1 ? "" : "s"}`;
    badge.className = `badge${entries.length ? " ok" : ""}`;
  }

  async function loadContextPolicy() {
    try {
      renderPolicies(await bench.policy.summary());
    } catch (error) {
      $("#context-info").textContent = error.message || String(error);
    }
  }

  async function loadSessionPolicy() {
    fillPolicyOptions();
    const sessionID = $("#context-session").value.trim();
    try {
      const policy = await bench.policy.read(sessionID);
      $("#context-auto").value = policy.auto ? "on" : "off";
      $("#context-threshold").value = String(policy.threshold);
      $("#context-window").value = String(policy.window);
    } catch (error) {
      toast(error.message || String(error), "error");
    }
  }

  async function saveSessionPolicy() {
    const sessionID = $("#context-session").value.trim();
    if (!sessionID) {
      toast("enter a session id", "error");
      return;
    }
    try {
      await bench.policy.write({
        sessionID,
        auto: $("#context-auto").value === "on",
        threshold: Number($("#context-threshold").value),
        window: Number($("#context-window").value),
      });
      toast("policy saved", "ok");
      await loadContextPolicy();
    } catch (error) {
      toast(error.message || String(error), "error");
    }
  }

  async function clearSessionPolicy() {
    const sessionID = $("#context-session").value.trim();
    if (!sessionID) return;
    try {
      await bench.policy.clear(sessionID);
      toast("session reset to defaults", "ok");
      await loadContextPolicy();
    } catch (error) {
      toast(error.message || String(error), "error");
    }
  }

  /* ---------------- settings: maintenance ---------------- */

  function renderBackups(backups) {
    const list = $("#backup-list");
    list.innerHTML = "";
    if (!backups.length) {
      list.innerHTML = '<div class="sidebar-empty">no snapshots yet</div>';
      return;
    }
    for (const entry of backups) {
      const card = document.createElement("div");
      card.className = "card";
      const files = entry.manifest?.files?.length || 0;
      card.innerHTML = `<div class="card-title"><span>${escapeHtml(entry.id)}</span><span class="badge">${escapeHtml(
        entry.manifest?.reason || "snapshot",
      )}</span></div><div class="card-sub">${files} files · ${shortNumber(entry.bytes)} bytes</div>`;
      const actions = document.createElement("div");
      actions.className = "card-actions";
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "btn btn-ghost";
      restore.textContent = "Restore";
      restore.onclick = async () => {
        if (!confirm(`Restore ${entry.id}? This overwrites the live session database and restarts the engine.`)) return;
        restore.disabled = true;
        restore.textContent = "restoring…";
        try {
          const result = await bench.maintenance.restore(entry.id);
          toast(`restored ${result.id} (${result.written.length} files)`, "ok");
          await loadMaintenance();
        } catch (error) {
          restore.disabled = false;
          restore.textContent = "Restore";
          toast(error.message || String(error), "error");
        }
      };
      actions.appendChild(restore);
      card.appendChild(actions);
      list.appendChild(card);
    }
  }

  function renderHistory(history) {
    return history
      .map((entry) => {
        const stamp = new Date(entry.at).toLocaleTimeString();
        return `${stamp}  ${entry.step.padEnd(8)} ${entry.status.padEnd(8)} ${entry.detail || ""}`;
      })
      .join("\n");
  }

  async function loadMaintenance() {
    try {
      const status = await bench.maintenance.status();
      $("#rotation-mode").value = status.rotation.mode || "off";
      $("#rotation-proxy").value = status.rotation.proxyUrl || "";
      $("#rotation-proxy").disabled = status.rotation.mode !== "proxy";
      $("#maintenance-badge").textContent =
        status.rotation.mode === "off" ? "direct" : `${status.rotation.mode} · #${status.rotation.rotations}`;
      renderBackups(status.backups || []);
      $("#maintenance-log").textContent =
        renderHistory(status.history || []) ||
        `data:   ${status.dataDir}\nbackups: ${status.backupsDir} (keep ${status.keep})`;
    } catch (error) {
      $("#maintenance-log").textContent = error.message || String(error);
    }
  }

  async function saveRotation() {
    try {
      const state = await bench.maintenance.rotation({
        mode: $("#rotation-mode").value,
        proxyUrl: $("#rotation-proxy").value.trim(),
      });
      toast(`rotation: ${state.mode}`, "ok");
      await loadMaintenance();
    } catch (error) {
      toast(error.message || String(error), "error");
    }
  }

  async function runReset() {
    const button = $("#reset-now");
    button.disabled = true;
    button.textContent = "resetting…";
    try {
      const report = await bench.maintenance.reset();
      $("#maintenance-log").textContent = report.steps
        .map((entry) => `${entry.step.padEnd(8)} ${entry.status.padEnd(8)} ${entry.detail || ""}`)
        .join("\n");
      toast(report.ok ? `reset complete in ${report.durationMs}ms` : `reset failed: ${report.error}`, report.ok ? "ok" : "error");
    } catch (error) {
      toast(error.message || String(error), "error");
    } finally {
      button.disabled = false;
      button.textContent = "Reset now";
      await loadMaintenance();
    }
  }

  async function runBackup() {
    const button = $("#backup-now");
    button.disabled = true;
    button.textContent = "snapshotting…";
    try {
      const result = await bench.maintenance.backup();
      toast(result.skipped ? result.reason : `snapshot ${result.id}`, result.skipped ? "error" : "ok");
    } catch (error) {
      toast(error.message || String(error), "error");
    } finally {
      button.disabled = false;
      button.textContent = "Backup now";
      await loadMaintenance();
    }
  }

  /* ---------------- settings: merge ---------------- */

  async function loadMerge() {
    const badge = $("#merge-badge");
    const info = $("#merge-info");
    try {
      const status = await bench.merge.status();
      badge.textContent = status.installed ? "installed" : "not installed";
      badge.className = `badge${status.installed ? " ok" : ""}`;
      info.textContent = [
        `config:   ${status.configFile}`,
        `plugin:   ${status.pluginFile}`,
        `layer:    ${status.layerHome}`,
        `state:    ${status.stateFile}`,
        `engine:   ${status.engineVersion || "not detected"}`,
        `compaction.auto: ${status.compactionAuto === undefined ? "(unset)" : status.compactionAuto}`,
        status.configError ? `config error: ${status.configError}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      $("#merge-install").disabled = status.installed;
      $("#merge-uninstall").disabled = !status.installed;
    } catch (error) {
      badge.textContent = "error";
      badge.className = "badge";
      info.textContent = error.message || String(error);
    }
  }

  async function installMerge() {
    const install = $("#merge-install");
    install.disabled = true;
    install.textContent = "installing...";
    try {
      await bench.merge.install();
      toast("layer installed - restart OpenCode to apply", "ok");
      await bench.server.restart();
    } catch (error) {
      toast(error.message || String(error), "error");
    } finally {
      install.textContent = "Install layer";
      await loadMerge();
    }
  }

  async function uninstallMerge() {
    if (!confirm("Remove the layer from the global opencode.json? The previous compaction.auto value is restored.")) return;
    const remove = $("#merge-uninstall");
    remove.disabled = true;
    remove.textContent = "removing...";
    try {
      await bench.merge.uninstall();
      toast("layer removed", "ok");
      await bench.server.restart();
    } catch (error) {
      toast(error.message || String(error), "error");
    } finally {
      remove.textContent = "Remove layer";
      await loadMerge();
    }
  }

  /* ---------------- plumbing ---------------- */

  function applyTheme() {
    document.documentElement.dataset.theme = state.settings?.theme || "sombra";
  }

  function switchTab(tab) {
    $$(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
    $$(".panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab));
    if (tab === "providers") loadProvidersPanel();
    if (tab === "mcp") loadMcpPanel();
    if (tab === "autojb") loadAutojb();
    if (tab === "profiles") loadProfiles();
    if (tab === "context") loadContextPolicy();
    if (tab === "merge") loadMerge();
    if (tab === "maintenance") loadMaintenance();
    if (tab === "skills") loadSkills();
    if (tab === "tools") loadCatalog();
    if (tab === "about") fillAbout();
  }

  function openSettings(tab = "general") {
    $("#settings-overlay").hidden = false;
    switchTab(tab);
    fillGeneral();
  }

  function wire() {
    $("#new-session").addEventListener("click", () => {
      state.sessionID = null;
      state.messages = [];
      state.streaming = false;
      $("#prompt").value = "";
      render();
      $("#prompt").focus();
    });

    $("#refresh-button").addEventListener("click", () => {
      loadSessions();
      loadMessages();
      refreshEngineMeta();
    });

    $("#session-search").addEventListener("input", (event) => {
      state.filter = event.target.value;
      renderSessions();
    });

    $("#project-button").addEventListener("click", async () => {
      try {
        const directory = await bench.dialog.directory();
        if (!directory) return;
        state.settings = await bench.settings.patch({ directory, lastDirectory: directory });
        $("#project-label").textContent = directory;
        $("#project-label").title = directory;
        state.sessions = [];
        state.sessionID = null;
        state.messages = [];
        render();
        await bench.server.restart();
        toast("project set — engine restarted", "ok");
      } catch (error) {
        toast(error.message || String(error), "error");
      }
    });

    $("#composer").addEventListener("submit", (event) => {
      event.preventDefault();
      sendPrompt($("#prompt").value);
    });

    const prompt = $("#prompt");
    prompt.addEventListener("input", () => autosize(prompt));
    prompt.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendPrompt(prompt.value);
      }
    });

    $("#stop-button").addEventListener("click", abortPrompt);
    $("#open-settings").addEventListener("click", () => openSettings());
    $("#close-settings").addEventListener("click", () => {
      $("#settings-overlay").hidden = true;
    });
    $("#settings-overlay").addEventListener("click", (event) => {
      if (event.target === $("#settings-overlay")) $("#settings-overlay").hidden = true;
    });

    $$("#settings-tabs .tab").forEach((button) => {
      button.addEventListener("click", () => switchTab(button.dataset.tab));
    });

    $("#setting-theme").addEventListener("change", async (event) => {
      state.settings = await bench.settings.patch({ theme: event.target.value });
      applyTheme();
    });

    $("#browse-cli").addEventListener("click", async () => {
      const file = await bench.dialog.file();
      if (file) $("#setting-cli").value = file;
    });
    $("#browse-directory").addEventListener("click", async () => {
      const directory = await bench.dialog.directory();
      if (directory) $("#setting-directory").value = directory;
    });
    $("#save-general").addEventListener("click", saveGeneral);
    $("#restart-server").addEventListener("click", async () => {
      try {
        await bench.server.restart();
      } catch (error) {
        toast(error.message || String(error), "error");
      }
    });

    $("#provider-form").addEventListener("submit", submitProvider);
    $("#provider-reset").addEventListener("click", () => $("#provider-form").reset());

    $("#mcp-form").addEventListener("submit", submitMcp);
    $("#mcp-reset").addEventListener("click", () => $("#mcp-form").reset());
    $("#mcp-form").elements.type.addEventListener("change", (event) => {
      const type = event.target.value;
      $$("#mcp-form [data-kind]").forEach((field) => {
        field.hidden = field.dataset.kind !== type;
      });
    });

    $("#refresh-skills").addEventListener("click", loadSkills);
    $("#autojb-save").addEventListener("click", saveAutojb);
    $("#autojb-reset").addEventListener("click", () => {
      $("#autojb-text").value = "";
      $("#autojb-status").textContent = "custom text cleared — save to apply the shipped default";
    });
    $("#refresh-catalog").addEventListener("click", loadCatalog);
    $("#catalog-search").addEventListener("input", debounce(loadCatalog, 250));

    $("#rotation-save").addEventListener("click", saveRotation);
    $("#profiles-select").addEventListener("change", selectProfile);
    $("#profiles-save").addEventListener("click", saveProfile);
    $("#profiles-new").addEventListener("click", () => {
      $("#profiles-select").value = "";
      $("#profiles-name").value = "";
      $("#profiles-content").value = "";
    });
    $("#profiles-delete").addEventListener("click", deleteProfile);
    $("#profiles-bind").addEventListener("click", () => bindProfile(false));
    $("#profiles-unbind").addEventListener("click", () => bindProfile(true));
    $("#profiles-pick").addEventListener("click", pickProfileScope);
    $("#profiles-refresh").addEventListener("click", loadProfiles);
    $("#context-save").addEventListener("click", saveSessionPolicy);
    $("#context-clear").addEventListener("click", clearSessionPolicy);
    $("#context-load").addEventListener("click", loadSessionPolicy);
    $("#merge-install").addEventListener("click", installMerge);
    $("#merge-uninstall").addEventListener("click", uninstallMerge);
    $("#merge-refresh").addEventListener("click", loadMerge);
    $("#reset-now").addEventListener("click", runReset);
    $("#backup-now").addEventListener("click", runBackup);
    $("#refresh-backups").addEventListener("click", loadMaintenance);
    $("#rotation-mode").addEventListener("change", (event) => {
      $("#rotation-proxy").disabled = event.target.value !== "proxy";
    });

    $("#open-config").addEventListener("click", () => {
      if (state.info) bench.shell.reveal(state.info.configFile);
    });
    $("#open-docs").addEventListener("click", () => bench.shell.open("https://opencode.ai/docs"));

    $("#model-button").addEventListener("click", () => {
      $("#model-overlay").hidden = false;
      renderModelList();
      $("#model-search").focus();
    });
    $("#close-models").addEventListener("click", () => {
      $("#model-overlay").hidden = true;
    });
    $("#model-overlay").addEventListener("click", (event) => {
      if (event.target === $("#model-overlay")) $("#model-overlay").hidden = true;
    });
    $("#model-search").addEventListener("input", renderModelList);
  }

  async function init() {
    wire();
    bindSuggestions();
    state.settings = await bench.settings.get();
    state.info = await bench.info();
    applyTheme();
    $("#project-label").textContent = state.settings.directory || "no project folder";
    $("#project-label").title = state.settings.directory || "";

    bench.onStatus(handleServerStatus);
    bench.onEvent(handleEvent);

    const status = await bench.server.status();
    handleServerStatus(status);
    if (status.state === "stopped" && state.settings.autoStart !== false) {
      try {
        await bench.server.start();
      } catch (error) {
        toast(`engine: ${error.message}`, "error");
      }
    }
    render();
  }

  window.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => toast(error.message || String(error), "error"));
  });
})();
