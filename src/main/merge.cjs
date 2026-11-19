// OpenBench — merge the layer into the installed OpenCode.
//
// The app always applies the layer to *its own* engine through OPENCODE_CONFIG_CONTENT.
// This module is the second path: it writes the plugin and the compaction switch into the
// user's global opencode.json, so an OpenCode Desktop install started outside OpenBench
// gets the same behaviour.
//
// Every write goes through config.cjs, which takes a timestamped backup before replacing
// the file. Uninstall removes exactly what install added and restores the previous
// compaction.auto value from the marker file, not from guesswork.
const fs = require("node:fs");
const path = require("node:path");
const configStore = require("./config.cjs");
const layer = require("./layer.cjs");
const store = require("./store.cjs");

function markerFile() {
  return path.join(layer.home(), "merge.json");
}

function readMarker() {
  return store.read(markerFile(), {});
}

function engineVersion() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "ai.opencode.desktop", "resources", "opencode-cli.version"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "ai.opencode.desktop", "resources", "opencode-cli.exe"),
  ];
  try {
    const file = candidates[0];
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  } catch {
    // fall through
  }
  return null;
}

function status() {
  const marker = readMarker();
  let config = {};
  let configError = null;
  try {
    config = configStore.read();
  } catch (error) {
    configError = error.message;
  }
  const entries = Array.isArray(config.plugins) ? config.plugins : [];
  const installed = entries.some((entry) => typeof entry === "string" && entry.includes("openbench-plugin"));
  return {
    installed,
    configFile: configStore.configFile(),
    configError,
    pluginEntry: layer.pluginEntry(),
    pluginFile: path.join(layer.pluginEntry(), "server.mjs"),
    layerHome: layer.home(),
    stateFile: path.join(layer.autojbDir(), "state.json"),
    compactionAuto: config.compaction?.auto,
    engineVersion: engineVersion(),
    installedAt: marker.installedAt || null,
    previousCompactionAuto: marker.previousCompactionAuto ?? null,
  };
}

function install({ resourcesRoot }) {
  layer.ensureEngine(resourcesRoot);
  layer.ensureState(resourcesRoot, { enabled: true, compactionAuto: true });

  const config = configStore.read();
  const previous = Array.isArray(config.plugins) ? config.plugins : [];
  const plugins = previous.filter(
    (entry) => typeof entry !== "string" || !entry.toLowerCase().includes("openbench-plugin"),
  );
  plugins.push(layer.pluginEntry());

  // Only record the original value the first time; a second install must not overwrite
  // it with the value install itself wrote.
  const marker = readMarker();
  if (typeof marker.previousCompactionAuto === "undefined") {
    marker.previousCompactionAuto = config.compaction?.auto ?? null;
  }
  marker.installedAt = Date.now();
  marker.pluginEntry = layer.pluginEntry();

  store.write(markerFile(), marker);
  configStore.write({
    ...config,
    plugins,
    compaction: { ...(config.compaction || {}), auto: false },
  });
  return status();
}

function uninstall() {
  const config = configStore.read();
  const plugins = (Array.isArray(config.plugins) ? config.plugins : []).filter(
    (entry) => typeof entry !== "string" || !entry.toLowerCase().includes("openbench-plugin"),
  );
  const marker = readMarker();
  const next = { ...config };
  if (plugins.length) next.plugins = plugins;
  else delete next.plugins;

  const restored = marker.previousCompactionAuto;
  if (restored === true || restored === false) {
    next.compaction = { ...(config.compaction || {}), auto: restored };
  } else if (next.compaction) {
    delete next.compaction.auto;
    if (Object.keys(next.compaction).length === 0) delete next.compaction;
  }

  configStore.write(next);
  try {
    fs.rmSync(markerFile(), { force: true });
  } catch {
    // marker removal is cosmetic; the config is the source of truth
  }
  return status();
}

module.exports = { status, install, uninstall, markerFile };
