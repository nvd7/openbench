// OpenBench — atomic JSON state store shared by the feature modules.
// Every write goes to a temp file in the same directory, then renames over the
// target, so a crash mid-write leaves either the old file or the new one intact.
const fs = require("node:fs");
const path = require("node:path");

function read(file, fallback) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    // A corrupt state file must not wedge startup: keep a copy and fall back.
    try {
      fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
    } catch {
      // best effort
    }
    return fallback;
  }
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
  return value;
}

function patch(file, fallback, partial) {
  return write(file, { ...read(file, fallback), ...partial });
}

module.exports = { read, write, patch };
