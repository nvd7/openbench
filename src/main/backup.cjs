// OpenBench — session store snapshots.
//
// The engine keeps sessions in a SQLite database next to its data directory. A live
// copy of a WAL database is only safe when the writer is quiet, so every snapshot in
// this module is taken with the engine stopped (the reset flow stops it first).
//
// A snapshot is a directory copy of db + -wal + -shm, gzipped, plus a manifest with
// the SHA-256 of each file. Retention keeps the newest N snapshots.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { pipeline } = require("node:stream/promises");

const KEEP_BACKUPS = 5;
const DB_FILES = ["opencode.db", "opencode.db-wal", "opencode.db-shm"];

function dataDir() {
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, "opencode");
}

function backupsDir(userData) {
  return path.join(userData, "backups");
}

function list(userData) {
  const root = backupsDir(userData);
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
  const items = entries.map((entry) => {
    const dir = path.join(root, entry.name);
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    } catch {
      manifest = null;
    }
    let bytes = 0;
    try {
      for (const file of fs.readdirSync(dir)) {
        const stat = fs.statSync(path.join(dir, file));
        if (stat.isFile()) bytes += stat.size;
      }
    } catch {
      bytes = 0;
    }
    return { id: entry.name, dir, bytes, manifest };
  });
  return items.sort((a, b) => (a.id < b.id ? 1 : -1));
}

async function sha256(file) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

async function gzipFile(source, target) {
  await pipeline(fs.createReadStream(source), zlib.createGzip({ level: 6 }), fs.createWriteStream(target));
}

function prune(userData, keep = KEEP_BACKUPS) {
  const items = list(userData);
  const removed = [];
  for (const item of items.slice(keep)) {
    try {
      fs.rmSync(item.dir, { recursive: true, force: true });
      removed.push(item.id);
    } catch {
      // leave it for the next prune
    }
  }
  return removed;
}

/**
 * Snapshot the session database. Returns { id, dir, files } or { skipped } when the
 * engine has never written a database.
 */
async function snapshot(userData, { reason = "manual" } = {}) {
  const source = dataDir();
  const dbPath = path.join(source, DB_FILES[0]);
  if (!fs.existsSync(dbPath)) {
    return { skipped: true, reason: "no database at " + dbPath };
  }

  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupsDir(userData), id);
  fs.mkdirSync(target, { recursive: true });

  const files = [];
  for (const name of DB_FILES) {
    const from = path.join(source, name);
    if (!fs.existsSync(from)) continue;
    const digest = await sha256(from);
    const to = path.join(target, `${name}.gz`);
    await gzipFile(from, to);
    files.push({ name, bytes: fs.statSync(from).size, sha256: digest });
  }

  const manifest = { id, reason, createdAt: Date.now(), source, files, keep: KEEP_BACKUPS };
  fs.writeFileSync(path.join(target, "manifest.json"), JSON.stringify(manifest, null, 2));
  const removed = prune(userData);
  return { skipped: false, id, dir: target, files, removed };
}

/**
 * Restore a snapshot over the live data directory. The engine must be stopped;
 * the caller owns that. Returns the list of files written.
 */
async function restore(userData, id) {
  const target = path.join(backupsDir(userData), id);
  const manifestPath = path.join(target, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`snapshot ${id} has no manifest`);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const destination = dataDir();
  fs.mkdirSync(destination, { recursive: true });

  const written = [];
  for (const entry of manifest.files || []) {
    const from = path.join(target, `${entry.name}.gz`);
    if (!fs.existsSync(from)) continue;
    const to = path.join(destination, entry.name);
    const temp = `${to}.restore-${process.pid}`;
    await pipeline(fs.createReadStream(from), zlib.createGunzip(), fs.createWriteStream(temp));
    fs.renameSync(temp, to);
    written.push(entry.name);
  }
  return { id, written };
}

module.exports = { snapshot, restore, list, prune, dataDir, backupsDir, KEEP_BACKUPS };
