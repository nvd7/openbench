// OpenBench — curated tool catalog and shallow clone into the user data directory.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function loadCatalog(resourcesRoot) {
  const file = path.join(resourcesRoot, "catalog.json");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(parsed.tools) ? parsed.tools : [];
}

function repositoryRoot(userData) {
  return path.join(userData, "tools", "repositories");
}

function repositoryDirectory(userData, id) {
  const base = path.resolve(repositoryRoot(userData));
  const target = path.resolve(base, id.replace("/", "--"));
  if (!target.startsWith(base + path.sep)) throw new Error("invalid repository id");
  return target;
}

function list(userData, resourcesRoot, query = "") {
  const needle = String(query || "").toLowerCase().slice(0, 200);
  return loadCatalog(resourcesRoot)
    .filter((item) => `${item.owner}/${item.repo} ${item.category} ${(item.tags || []).join(" ")}`.toLowerCase().includes(needle))
    .map((item) => {
      const id = `${item.owner}/${item.repo}`;
      const directory = repositoryDirectory(userData, id);
      return {
        id,
        url: item.url,
        category: item.category,
        description: item.description || "",
        directory,
        cloned: fs.existsSync(path.join(directory, ".git")),
      };
    });
}

function clone(userData, resourcesRoot, id) {
  const entry = loadCatalog(resourcesRoot).find((item) => `${item.owner}/${item.repo}` === id);
  if (!entry) throw new Error("unknown catalog entry");
  const directory = repositoryDirectory(userData, id);
  if (fs.existsSync(directory)) throw new Error("target directory already exists");
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      ["-c", "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"), "clone", "--depth", "1", "--", entry.url, directory],
      { windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" } },
    );
    let output = "";
    const collect = (data) => {
      output = (output + data.toString()).slice(-4000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("git clone timed out"));
    }, 180000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true, directory, output });
      else reject(new Error(output || `git exited ${code}`));
    });
  });
}

module.exports = { list, clone, repositoryDirectory };
