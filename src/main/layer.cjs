// OpenBench — engine layer installation.
//
// The layer is a small ESM bundle in resources/engine. It has to live outside the app
// bundle: the engine resolves plugins by absolute path, and a packaged app's resources
// may sit inside an archive. Every consumer (the app's own engine, the global config, a
// patched desktop install) points at this one copy.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const FILES = ["package.json", "server.mjs", "state.mjs", "policy.mjs", "skills.mjs"];

function home() {
  if (process.env.OPENBENCH_HOME) return process.env.OPENBENCH_HOME;
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share");
  return path.join(base, "OpenBench");
}

function engineDir() {
  return path.join(home(), "engine");
}

/**
 * Plugin entry is a directory, not a file: the engine skips single-file paths and reads
 * package.json `exports` (or server/index) inside the directory.
 */
function pluginEntry() {
  return path.join(engineDir(), "openbench-plugin");
}

function autojbDir() {
  return path.join(home(), "autojb");
}

/** Copy the shipped layer into OPENBENCH_HOME, refreshing changed files. */
function ensureEngine(resourcesRoot) {
  const source = path.join(resourcesRoot, "engine", "openbench-plugin");
  const target = pluginEntry();
  fs.mkdirSync(target, { recursive: true });
  for (const name of FILES) {
    const from = path.join(source, name);
    const to = path.join(target, name);
    const stat = fs.statSync(from);
    let current = null;
    try {
      current = fs.statSync(to);
    } catch {
      current = null;
    }
    if (!current || current.size !== stat.size || current.mtimeMs < stat.mtimeMs) {
      fs.copyFileSync(from, to);
    }
  }
  return { home: home(), engineDir: engineDir(), pluginEntry: target };
}

/** Seed the brief/state files without overwriting anything the user already edited. */
function ensureState(resourcesRoot, defaults) {
  const dir = autojbDir();
  fs.mkdirSync(dir, { recursive: true });
  const brief = path.join(dir, "instructions.md");
  if (!fs.existsSync(brief)) {
    const source = path.join(resourcesRoot, "autojb-default.txt");
    if (fs.existsSync(source)) fs.copyFileSync(source, brief);
  }
  const state = path.join(dir, "state.json");
  if (!fs.existsSync(state)) {
    fs.writeFileSync(
      state,
      JSON.stringify(
        {
          enabled: defaults?.enabled !== false,
          compactionAuto: defaults?.compactionAuto !== false,
          customText: "",
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
  return { dir, brief, state };
}

module.exports = { home, engineDir, pluginEntry, autojbDir, ensureEngine, ensureState, FILES };
