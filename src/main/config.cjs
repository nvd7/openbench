// OpenBench — global opencode.json access with backups and atomic replacement.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function configFile() {
  const base = process.env.XDG_CONFIG_HOME || (process.platform === "win32" ? path.join(os.homedir(), ".config") : path.join(os.homedir(), ".config"));
  return path.join(base, "opencode", "opencode.json");
}

function read() {
  const file = configFile();
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error("opencode.json is not valid JSON: " + error.message);
  }
}

function write(value) {
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, `${file}.before-openbench-${Date.now()}`);
  }
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
  fs.renameSync(temp, file);
}

module.exports = { configFile, read, write };
