// OpenBench — per-session context policy.
//
// The engine layer compacts on idle. This module owns the thresholds the plugin reads:
// auto (on/off per session), threshold (25/50/65/75/80/95 percent) and window (how much
// of the model window is usable: 25/50/75/100). Writes the same file the plugin reads.
//
// File: %LOCALAPPDATA%\OpenBench\context\sessions.json
const fs = require("node:fs");
const path = require("node:path");
const layer = require("./layer.cjs");
const store = require("./store.cjs");

const THRESHOLDS = [25, 50, 65, 75, 80, 95];
const WINDOWS = [25, 50, 75, 100];
const DEFAULT_POLICY = { auto: true, threshold: 75, window: 100 };

function dir() {
  return path.join(layer.home(), "context");
}

function file() {
  return path.join(dir(), "sessions.json");
}

function readAll() {
  const value = store.read(file(), {});
  return value && typeof value === "object" ? value : {};
}

function normalize(value = {}) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    auto: typeof raw.auto === "boolean" ? raw.auto : DEFAULT_POLICY.auto,
    threshold: THRESHOLDS.includes(raw.threshold) ? raw.threshold : DEFAULT_POLICY.threshold,
    window: WINDOWS.includes(raw.window) ? raw.window : DEFAULT_POLICY.window,
  };
}

function read(sessionID) {
  if (!sessionID) return { ...DEFAULT_POLICY };
  return normalize(readAll()[sessionID]);
}

function write(sessionID, patch) {
  if (typeof sessionID !== "string" || !/^ses_[a-zA-Z0-9]{1,100}$/.test(sessionID)) {
    throw new Error("Invalid session id.");
  }
  const all = readAll();
  const current = read(sessionID);
  const next = { ...current };
  // Invalid values are dropped, not coerced: a refused patch must leave the stored
  // policy intact instead of silently resetting it to the defaults.
  if (typeof patch?.auto === "boolean") next.auto = patch.auto;
  if (THRESHOLDS.includes(patch?.threshold)) next.threshold = patch.threshold;
  if (WINDOWS.includes(patch?.window)) next.window = patch.window;
  all[sessionID] = next;
  fs.mkdirSync(dir(), { recursive: true });
  store.write(file(), all);
  return next;
}

function clear(sessionID) {
  const all = readAll();
  delete all[sessionID];
  fs.mkdirSync(dir(), { recursive: true });
  store.write(file(), all);
  return { ...DEFAULT_POLICY };
}

function summary() {
  return { file: file(), thresholds: THRESHOLDS, windows: WINDOWS, defaults: DEFAULT_POLICY, sessions: readAll() };
}

module.exports = { THRESHOLDS, WINDOWS, DEFAULT_POLICY, dir, file, read, write, clear, normalize, summary };
