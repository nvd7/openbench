// OpenBench — instruction profiles.
//
// A profile is a named brief that can be bound to a session, to a project directory, or
// set as the global default. The engine layer resolves the binding itself
// (resources/engine/openbench-plugin/state.mjs), so this module is the editing surface:
// it reads and writes the same profiles.json the plugin reads.
//
// File: %LOCALAPPDATA%\OpenBench\autojb\profiles.json
const fs = require("node:fs");
const path = require("node:path");
const layer = require("./layer.cjs");
const store = require("./store.cjs");

const MAX_PROFILES = 50;
const MAX_CHARS = 100000;

function file() {
  return path.join(layer.autojbDir(), "profiles.json");
}

function empty() {
  return { schema: 1, profiles: [], projects: {}, sessions: {}, defaultID: "" };
}

function read() {
  const value = store.read(file(), empty());
  if (!value || !Array.isArray(value.profiles)) return empty();
  return {
    schema: 1,
    profiles: value.profiles.filter((item) => item && typeof item.id === "string"),
    projects: value.projects && typeof value.projects === "object" ? value.projects : {},
    sessions: value.sessions && typeof value.sessions === "object" ? value.sessions : {},
    defaultID: typeof value.defaultID === "string" ? value.defaultID : "",
  };
}

function write(value) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  store.write(file(), value);
  return value;
}

function normalizeDirectory(value) {
  if (typeof value !== "string" || !value || value.length > 4096 || !path.isAbsolute(value)) return "";
  const resolved = path.normalize(path.resolve(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function save({ id, name, content } = {}) {
  if (typeof name !== "string" || !name.trim() || name.length > 80) {
    throw new Error("Profile name is required (max 80 characters).");
  }
  if (typeof content !== "string" || !content.trim() || content.length > MAX_CHARS) {
    throw new Error(`Profile content is required (max ${MAX_CHARS} characters).`);
  }
  const value = read();
  let item = id ? value.profiles.find((entry) => entry.id === id) : null;
  if (!item) {
    if (value.profiles.length >= MAX_PROFILES) throw new Error("Profile limit reached (50).");
    item = { id: `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` };
    value.profiles.push(item);
  }
  item.name = name.trim();
  item.content = content;
  write(value);
  return item;
}

function remove(id) {
  const value = read();
  value.profiles = value.profiles.filter((entry) => entry.id !== id);
  for (const map of [value.projects, value.sessions]) {
    for (const key of Object.keys(map)) if (map[key] === id) delete map[key];
  }
  if (value.defaultID === id) value.defaultID = "";
  write(value);
  return value;
}

function bind({ id = "", scope = {} } = {}) {
  const value = read();
  if (id && !value.profiles.some((entry) => entry.id === id)) throw new Error("Unknown profile.");
  if (scope.sessionID) {
    if (!/^ses_[a-zA-Z0-9]{1,100}$/.test(scope.sessionID)) throw new Error("Invalid session id.");
    if (id) value.sessions[scope.sessionID] = id;
    else delete value.sessions[scope.sessionID];
  } else if (scope.directory) {
    const directory = normalizeDirectory(scope.directory);
    if (!directory) throw new Error("Project directory must be an absolute path.");
    if (id) value.projects[directory] = id;
    else delete value.projects[directory];
  } else {
    value.defaultID = id;
  }
  write(value);
  return value;
}

/** Which profile applies to a scope, mirroring the engine's resolution order. */
function selected({ sessionID, directory } = {}) {
  const value = read();
  const dir = normalizeDirectory(directory || "");
  const id =
    (sessionID && value.sessions[sessionID]) ||
    (dir && value.projects[dir]) ||
    value.defaultID ||
    "";
  if (!id) return null;
  return value.profiles.find((profile) => profile.id === id) || null;
}

function summary() {
  const value = read();
  return {
    file: file(),
    profiles: value.profiles.map(({ id, name, content }) => ({ id, name, length: content.length })),
    projects: value.projects,
    sessions: value.sessions,
    defaultID: value.defaultID,
    selected: selected({}),
    limits: { profiles: MAX_PROFILES, chars: MAX_CHARS },
  };
}

module.exports = { file, read, write, save, remove, bind, selected, summary, normalizeDirectory, MAX_PROFILES, MAX_CHARS };
