// OpenBench — persisted settings. Atomic JSON writes, no secrets in logs.
const fs = require("node:fs");
const path = require("node:path");

const DEFAULTS = Object.freeze({
  cliPath: "",
  port: 0,
  theme: "sombra",
  model: null,
  lastDirectory: "",
  directory: "",
  window: { width: 1280, height: 820 },
  autoStart: true,
});

function settingsFile(userData) {
  return path.join(userData, "settings.json");
}

function load(userData) {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(userData), "utf8"));
    return { ...DEFAULTS, ...raw, window: { ...DEFAULTS.window, ...(raw.window || {}) } };
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("[openbench] settings unreadable, using defaults:", error.message);
    return { ...DEFAULTS };
  }
}

function save(userData, value) {
  const file = settingsFile(userData);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
  return value;
}

function patch(userData, partial) {
  const next = { ...load(userData), ...partial };
  if (partial && typeof partial.window === "object") next.window = { ...load(userData).window, ...partial.window };
  return save(userData, next);
}

module.exports = { DEFAULTS, load, save, patch, settingsFile };
