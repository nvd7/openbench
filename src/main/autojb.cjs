// OpenBench — Auto-JB state and engine override.
//
// The brief itself is applied by the engine layer (resources/engine/openbench-plugin.mjs),
// not by `instructions`. That difference matters: `instructions` is read when the session
// is created, so editing it has no effect until a new session; the plugin pushes the brief
// into the system array on every request-building hook, so the next turn sees the change.
//
// This module owns three things:
//   - the on-disk state the plugin reads (enabled, compactionAuto, customText)
//   - the generated brief file the plugin falls back to
//   - OPENCODE_CONFIG_CONTENT, which registers the plugin and switches the engine's own
//     auto compaction off so the plugin can own the decision.
const fs = require("node:fs");
const path = require("node:path");
const store = require("./store.cjs");
const layer = require("./layer.cjs");

const DEFAULTS = {
  enabled: true,
  compactionAuto: true,
  customText: "",
};

function paths() {
  const dir = layer.autojbDir();
  return {
    dir,
    state: path.join(dir, "state.json"),
    instructions: path.join(dir, "instructions.md"),
    profiles: path.join(dir, "profiles.json"),
  };
}

function load() {
  const state = { ...DEFAULTS, ...store.read(paths().state, {}) };
  return {
    enabled: state.enabled !== false,
    compactionAuto: state.compactionAuto !== false,
    customText: typeof state.customText === "string" ? state.customText : "",
  };
}

function save(partial) {
  const next = { ...load(), ...(partial || {}) };
  const clean = {
    enabled: next.enabled !== false,
    compactionAuto: next.compactionAuto !== false,
    customText: String(next.customText || ""),
  };
  store.write(paths().state, clean);
  return clean;
}

function defaultText(resourcesRoot) {
  const file = path.join(resourcesRoot, "autojb-default.txt");
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** Effective brief: the user's text when set, otherwise the shipped default. */
function text(resourcesRoot) {
  const state = load();
  const custom = state.customText.trim();
  return custom || defaultText(resourcesRoot);
}

function meta(resourcesRoot) {
  const state = load();
  const effective = text(resourcesRoot);
  const target = paths();
  const engine = layer.pluginEntry();
  return {
    enabled: state.enabled,
    compactionAuto: state.compactionAuto,
    usingCustomText: Boolean(state.customText.trim()),
    textLength: effective.length,
    defaultText: defaultText(resourcesRoot),
    customText: state.customText,
    instructionsFile: target.instructions,
    stateFile: target.state,
    pluginEntry: engine,
    pluginInstalled: fs.existsSync(path.join(engine, "server.mjs")),
    error: null,
  };
}

function isOpenBenchPlugin(entry) {
  return typeof entry === "string" && entry.toLowerCase().includes("openbench-plugin");
}

/**
 * Merged config handed to the engine at spawn, or null when the feature is off.
 * `base` is the user's global opencode.json, so the override only changes the keys it
 * owns: the plugin entry and compaction.auto.
 */
function buildConfigContent({ resourcesRoot, base }) {
  const state = load();
  if (!state.enabled) return null;

  const brief = text(resourcesRoot);
  if (!brief) return null;

  const target = paths();
  fs.mkdirSync(target.dir, { recursive: true });
  fs.writeFileSync(target.instructions, brief, { mode: 0o600 });
  layer.ensureEngine(resourcesRoot);

  const existing = Array.isArray(base?.plugins) ? base.plugins : [];
  const plugins = existing.filter((entry) => !isOpenBenchPlugin(entry));
  plugins.push(layer.pluginEntry());

  return {
    ...(base || {}),
    plugins,
    // The plugin compacts on idle at a budget threshold; the engine's own trigger would
    // summarise mid-conversation and race it.
    compaction: { ...((base && base.compaction) || {}), auto: false },
  };
}

module.exports = { load, save, meta, text, defaultText, buildConfigContent, paths, isOpenBenchPlugin };
