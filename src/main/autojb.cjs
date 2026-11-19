// OpenBench — Auto-JB: instruction injection and compaction control.
//
// The engine reads OPENCODE_CONFIG_CONTENT at spawn and merges it over the user's
// global opencode.json. That gives the app two levers without touching the user's
// file on disk:
//
//   1. `instructions: [<file>]` — a standing system-level brief applied to every
//      session. File lives in userData so the user can edit it in place.
//   2. `compaction.auto: false` — long sessions keep their full transcript instead
//      of being silently summarised. Costs context budget; that is the trade.
//
// Nothing here is applied unless the feature is enabled in settings.
const fs = require("node:fs");
const path = require("node:path");
const store = require("./store.cjs");

const DEFAULTS = {
  enabled: true,
  compactionAuto: false,
  customText: "",
};

function paths(userData) {
  const dir = path.join(userData, "autojb");
  return {
    dir,
    state: path.join(dir, "state.json"),
    instructions: path.join(dir, "instructions.md"),
  };
}

function load(userData) {
  const state = { ...DEFAULTS, ...store.read(paths(userData).state, {}) };
  return {
    enabled: Boolean(state.enabled),
    compactionAuto: Boolean(state.compactionAuto),
    customText: typeof state.customText === "string" ? state.customText : "",
  };
}

function save(userData, partial) {
  const next = { ...load(userData), ...(partial || {}) };
  const clean = {
    enabled: Boolean(next.enabled),
    compactionAuto: Boolean(next.compactionAuto),
    customText: String(next.customText || ""),
  };
  store.write(paths(userData).state, clean);
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
function text(userData, resourcesRoot) {
  const state = load(userData);
  const custom = state.customText.trim();
  return custom || defaultText(resourcesRoot);
}

function meta(userData, resourcesRoot) {
  const state = load(userData);
  const effective = text(userData, resourcesRoot);
  return {
    enabled: state.enabled,
    compactionAuto: state.compactionAuto,
    usingCustomText: Boolean(state.customText.trim()),
    textLength: effective.length,
    defaultText: defaultText(resourcesRoot),
    customText: state.customText,
    instructionsFile: paths(userData).instructions,
    error: null,
  };
}

/**
 * Merged config handed to the engine at spawn, or null when the feature is off.
 * `base` is the user's global opencode.json, so the override only changes the two
 * keys it owns.
 */
function buildConfigContent({ userData, resourcesRoot, base }) {
  const state = load(userData);
  if (!state.enabled) return null;

  const brief = text(userData, resourcesRoot);
  if (!brief) return null;

  const target = paths(userData);
  fs.mkdirSync(target.dir, { recursive: true });
  fs.writeFileSync(target.instructions, brief, { mode: 0o600 });

  const existing = Array.isArray(base?.instructions) ? base.instructions : [];
  const instructions = existing.includes(target.instructions)
    ? existing
    : [...existing, target.instructions];

  return {
    ...(base || {}),
    instructions,
    compaction: { ...((base && base.compaction) || {}), auto: state.compactionAuto },
  };
}

module.exports = { load, save, meta, text, defaultText, buildConfigContent, paths };
