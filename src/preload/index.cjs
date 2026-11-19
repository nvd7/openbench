// OpenBench — narrow, context-isolated bridge.
const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld("bench", {
  settings: {
    get: () => invoke("settings:get"),
    patch: (partial) => invoke("settings:patch", partial),
  },
  server: {
    start: () => invoke("server:start"),
    stop: () => invoke("server:stop"),
    restart: () => invoke("server:restart"),
    status: () => invoke("server:status"),
  },
  sessions: {
    list: () => invoke("sessions:list"),
    create: (body) => invoke("sessions:create", body),
    messages: (id) => invoke("sessions:messages", id),
    prompt: (id, body) => invoke("sessions:prompt", { id, body }),
    abort: (id) => invoke("sessions:abort", id),
    remove: (id) => invoke("sessions:delete", id),
  },
  engine: {
    models: () => invoke("engine:models"),
    providers: () => invoke("engine:providers"),
    agents: () => invoke("engine:agents"),
    skills: () => invoke("engine:skills"),
    mcp: () => invoke("engine:mcp"),
    mcpConnect: (name) => invoke("engine:mcp-connect", name),
    config: () => invoke("engine:config"),
  },
  providers: {
    list: () => invoke("providers:list"),
    save: (value) => invoke("providers:save", value),
    remove: (id) => invoke("providers:remove", id),
  },
  mcp: {
    list: () => invoke("mcp:list"),
    save: (name, value) => invoke("mcp:save", { name, value }),
    remove: (name) => invoke("mcp:remove", name),
  },
  skills: {
    list: () => invoke("skills:list"),
  },
  catalog: {
    list: (query) => invoke("catalog:list", query),
    clone: (id) => invoke("catalog:clone", id),
  },
  dialog: {
    directory: () => invoke("dialog:directory"),
    file: () => invoke("dialog:file"),
  },
  shell: {
    open: (target) => invoke("shell:open", target),
    reveal: (target) => invoke("shell:reveal", target),
  },
  info: () => invoke("app:info"),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("bench:event", listener);
    return () => ipcRenderer.removeListener("bench:event", listener);
  },
  onStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("bench:status", listener);
    return () => ipcRenderer.removeListener("bench:status", listener);
  },
});
