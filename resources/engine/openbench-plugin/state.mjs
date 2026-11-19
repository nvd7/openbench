// OpenBench engine layer — shared state.
//
// This module runs *inside the engine process*, loaded as an OpenCode plugin. It must
// not depend on Electron or on the OpenBench app being alive. Everything it needs is
// on disk under OPENBENCH_HOME (the app sets it; standalone installs fall back to
// %LOCALAPPDATA%\OpenBench).
//
// Resolution order for the standing brief:
//   1. profile bound to the session      (profiles.json sessions[ses_id])
//   2. profile bound to the project dir  (profiles.json projects[dir])
//   3. default profile                   (profiles.json defaultID)
//   4. customText in state.json          (legacy single brief)
//   5. autojb/instructions.md            (shipped default, editable)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MAX_BRIEF = 750000;
export const DEFAULT_STATE = { enabled: true, compactionAuto: true, customText: "" };
const MAX_PROFILES = 50;
const MAX_PROFILE_CHARS = 100000;

export function home() {
  if (process.env.OPENBENCH_HOME) return process.env.OPENBENCH_HOME;
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share");
  return path.join(base, "OpenBench");
}

export function autojbDir() {
  return path.join(home(), "autojb");
}

export function statePath() {
  return path.join(autojbDir(), "state.json");
}

export function briefPath() {
  return path.join(autojbDir(), "instructions.md");
}

export function profilesPath() {
  return path.join(autojbDir(), "profiles.json");
}

/** Windows paths are case-insensitive; every other platform compares as-is. */
export function normalizeDirectory(value) {
  if (typeof value !== "string" || !value || value.length > 4096 || !path.isAbsolute(value)) return "";
  const resolved = path.normalize(path.resolve(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function readState() {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    return {
      enabled: raw.enabled !== false,
      compactionAuto: raw.compactionAuto !== false,
      customText: typeof raw.customText === "string" ? raw.customText : "",
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function readProfiles() {
  try {
    const value = JSON.parse(fs.readFileSync(profilesPath(), "utf8"));
    if (!Array.isArray(value.profiles)) throw new Error("schema");
    return {
      schema: 1,
      profiles: value.profiles.filter((item) => item && typeof item.id === "string"),
      projects: value.projects && typeof value.projects === "object" ? value.projects : {},
      sessions: value.sessions && typeof value.sessions === "object" ? value.sessions : {},
      defaultID: typeof value.defaultID === "string" ? value.defaultID : "",
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("[openbench-profiles]", error.message);
    }
    return { schema: 1, profiles: [], projects: {}, sessions: {}, defaultID: "" };
  }
}

export function writeProfiles(value, writer = fs) {
  const text = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(text) > 2_000_000) throw new Error("profiles exceed 2 MB");
  fs.mkdirSync(autojbDir(), { recursive: true });
  const temp = `${profilesPath()}.${process.pid}.tmp`;
  writer.writeFileSync(temp, text, "utf8");
  fs.renameSync(temp, profilesPath());
  return value;
}

/** The profile bound to this session, project or default — or null. */
export function selectedProfile(scope = {}) {
  const value = readProfiles();
  const directory = normalizeDirectory(scope.directory || "");
  const id =
    (scope.sessionID && value.sessions[scope.sessionID]) ||
    (directory && value.projects[directory]) ||
    value.defaultID ||
    "";
  if (!id) return null;
  return value.profiles.find((profile) => profile.id === id) || null;
}

/** Effective brief for a scope (session + project directory). */
export function readBrief(state = readState(), scope = {}) {
  const profile = selectedProfile(scope);
  if (profile && typeof profile.content === "string" && profile.content.trim()) {
    return profile.content.slice(0, MAX_BRIEF);
  }
  const custom = state.customText.trim();
  if (custom) return custom.slice(0, MAX_BRIEF);
  try {
    return fs.readFileSync(briefPath(), "utf8").slice(0, MAX_BRIEF);
  } catch {
    return "";
  }
}

/** Create or update one profile. Returns the stored profile. */
export function saveProfile({ id, name, content } = {}) {
  if (typeof name !== "string" || !name.trim() || name.length > 80) {
    throw new Error("profile name is required (max 80 chars)");
  }
  if (typeof content !== "string" || !content.trim() || content.length > MAX_PROFILE_CHARS) {
    throw new Error(`profile content is required (max ${MAX_PROFILE_CHARS} chars)`);
  }
  const value = readProfiles();
  let item = id ? value.profiles.find((entry) => entry.id === id) : null;
  if (!item) {
    if (value.profiles.length >= MAX_PROFILES) throw new Error("profile limit reached");
    item = { id: `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` };
    value.profiles.push(item);
  }
  item.name = name.trim();
  item.content = content;
  writeProfiles(value);
  return item;
}

export function deleteProfile(id) {
  const value = readProfiles();
  value.profiles = value.profiles.filter((entry) => entry.id !== id);
  for (const map of [value.projects, value.sessions]) {
    for (const key of Object.keys(map)) if (map[key] === id) delete map[key];
  }
  if (value.defaultID === id) value.defaultID = "";
  writeProfiles(value);
  return value;
}

/**
 * Bind a profile to a session, a project directory, or globally (empty scope).
 * `id` empty unbinds. Returns true when the binding changed.
 */
export function bindProfile({ id = "", scope = {} } = {}) {
  const value = readProfiles();
  if (id && !value.profiles.some((entry) => entry.id === id)) throw new Error("unknown profile");
  if (scope.sessionID) {
    if (!/^ses_[a-zA-Z0-9]{1,100}$/.test(scope.sessionID)) throw new Error("invalid session id");
    if (id) value.sessions[scope.sessionID] = id;
    else delete value.sessions[scope.sessionID];
  } else if (scope.directory) {
    const directory = normalizeDirectory(scope.directory);
    if (!directory) throw new Error("project directory must be an absolute path");
    if (id) value.projects[directory] = id;
    else delete value.projects[directory];
  } else {
    value.defaultID = id;
  }
  writeProfiles(value);
  return true;
}
