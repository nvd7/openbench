// OpenBench — Electron main process.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const settingsStore = require("./settings.cjs");
const { BenchServer } = require("./server.cjs");
const catalog = require("./catalog.cjs");
const skills = require("./skills.cjs");
const providers = require("./providers.cjs");
const mcp = require("./mcp.cjs");

const appRoot = app.getAppPath();
const resourcesRoot = app.isPackaged ? path.join(process.resourcesPath, "resources") : path.join(appRoot, "resources");
const userData = app.getPath("userData");

let mainWindow = null;
let settings = null;
let server = null;

function resolveCli() {
  const candidates = [];
  if (settings?.cliPath) candidates.push(settings.cliPath);
  if (process.env.OPENCODE_BIN) candidates.push(process.env.OPENCODE_BIN);
  if (app.isPackaged) candidates.push(path.join(process.resourcesPath, "opencode-cli.exe"));
  candidates.push(path.join(appRoot, "resources", "opencode-cli.exe"));
  for (const candidate of candidates) {
    try {
      if (candidate && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // keep looking
    }
  }
  const names = ["opencode.exe", "opencode.cmd", "opencode"];
  for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      try {
        const file = path.join(dir.replace(/^"|"$/g, ""), name);
        if (fs.statSync(file).isFile()) return file;
      } catch {
        // keep looking
      }
    }
  }
  // TokenCode-style sidecar layout, read-only convenience.
  const sidecarRoot = path.join(process.env.LOCALAPPDATA || "", "TokenCode", "packages");
  try {
    for (const entry of fs.readdirSync(sidecarRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sidecar = path.join(sidecarRoot, entry.name, "app", "resources", "opencode-cli.exe");
      if (fs.statSync(sidecar).isFile()) return sidecar;
    }
  } catch {
    // no sidecar install
  }
  return null;
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function registerIpc() {
  ipcMain.handle("settings:get", () => settings);
  ipcMain.handle("settings:patch", (_event, partial) => {
    settings = settingsStore.patch(userData, partial || {});
    return settings;
  });

  const startServer = async () => {
    server.portOverride = settings.port;
    server.cwd = settings.directory || undefined;
    return server.start();
  };

  ipcMain.handle("server:start", startServer);
  ipcMain.handle("server:stop", async () => {
    await server.stop();
    return server.status();
  });
  ipcMain.handle("server:restart", async () => {
    await server.stop();
    return startServer();
  });
  ipcMain.handle("server:status", () => server.status());

  // Sessions
  ipcMain.handle("sessions:list", () => server.request("GET", "/session"));
  ipcMain.handle("sessions:create", (_event, body) => server.request("POST", "/session", body || {}));
  ipcMain.handle("sessions:messages", (_event, id) => server.request("GET", `/session/${encodeURIComponent(id)}/message`));
  ipcMain.handle("sessions:prompt", (_event, { id, body }) => {
    const payload = body || {};
    // v2 takes { text, model }; v1 takes { parts: [{ type: "text", text }], model }
    const shaped =
      server.mode === "v2"
        ? { ...payload, parts: undefined }
        : { ...payload, parts: payload.text ? [{ type: "text", text: payload.text }] : payload.parts };
    if (server.mode === "v2") delete shaped.parts;
    return server.request("POST", `/session/${encodeURIComponent(id)}/prompt`, shaped, { timeout: 15000 });
  });
  ipcMain.handle("sessions:abort", (_event, id) => {
    const route = server.mode === "v2" ? "interrupt" : "abort";
    return server.request("POST", `/session/${encodeURIComponent(id)}/${route}`, {}, { timeout: 15000 });
  });
  ipcMain.handle("sessions:delete", (_event, id) => server.request("DELETE", `/session/${encodeURIComponent(id)}`));

  // Engine metadata
  ipcMain.handle("engine:models", () => server.request("GET", "/model"));
  ipcMain.handle("engine:providers", () => server.request("GET", "/provider"));
  ipcMain.handle("engine:agents", () => server.request("GET", "/agent"));
  ipcMain.handle("engine:skills", () => server.request("GET", "/skill"));
  ipcMain.handle("engine:mcp", () => server.request("GET", "/mcp"));
  ipcMain.handle("engine:mcp-connect", (_event, name) => server.request("POST", `/mcp/${encodeURIComponent(name)}/connect`, {}));
  ipcMain.handle("engine:config", () => server.request("GET", "/config"));

  // opencode.json editors
  ipcMain.handle("providers:list", () => providers.list());
  ipcMain.handle("providers:save", (_event, value) => providers.save(value));
  ipcMain.handle("providers:remove", (_event, id) => providers.remove(id));

  ipcMain.handle("mcp:list", () => mcp.list());
  ipcMain.handle("mcp:save", (_event, { name, value }) => mcp.save(name, value));
  ipcMain.handle("mcp:remove", (_event, name) => mcp.remove(name));

  ipcMain.handle("skills:list", () => skills.list(settings.lastDirectory || null));

  ipcMain.handle("catalog:list", (_event, query) => catalog.list(userData, resourcesRoot, query));
  ipcMain.handle("catalog:clone", (_event, id) => catalog.clone(userData, resourcesRoot, id));

  ipcMain.handle("dialog:directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("dialog:file", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"] });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("shell:open", (_event, target) => shell.openExternal(String(target)));
  ipcMain.handle("shell:reveal", (_event, target) => shell.showItemInFolder(String(target)));
  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    resourcesRoot,
    configFile: require("./config.cjs").configFile(),
    userData,
  }));
}

function createWindow() {
  const bounds = settings.window || { width: 1280, height: 820 };
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 940,
    minHeight: 620,
    backgroundColor: "#0b0d11",
    title: "OpenBench",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("close", () => {
    const size = mainWindow.getSize();
    settings = settingsStore.patch(userData, { window: { width: size[0], height: size[1] } });
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    settings = settingsStore.load(userData);
    server = new BenchServer({ resolveCli, userData });
    server.on("event", (event) => send("bench:event", event));
    server.on("status", (status) => send("bench:status", status));

    registerIpc();
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "View",
          submenu: [
            { role: "reload" },
            { role: "toggleDevTools" },
            { type: "separator" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
          ],
        },
        { label: "Help", submenu: [{ label: "OpenCode docs", click: () => shell.openExternal("https://opencode.ai/docs") }] },
      ]),
    );
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    server?.stop().catch(() => {});
  });
}
