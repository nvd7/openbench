// OpenBench — read-only skill discovery from the standard OpenCode/agents folders.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function skillRoots(projectDirectory) {
  const config = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const roots = [
    path.join(config, "opencode", "skill"),
    path.join(config, "opencode", "skills"),
    path.join(os.homedir(), ".agents", "skills"),
  ];
  if (projectDirectory) {
    roots.unshift(path.join(projectDirectory, ".opencode", "skill"));
    roots.unshift(path.join(projectDirectory, ".opencode", "skills"));
  }
  return [...new Set(roots)];
}

function parseFrontmatter(text) {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end < 0) return {};
  const block = text.slice(3, end).split(/\r?\n/);
  const result = {};
  for (const line of block) {
    const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (match) result[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return result;
}

function list(projectDirectory) {
  const seen = new Set();
  const skills = [];
  for (const root of skillRoots(projectDirectory)) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(root, entry.name, "SKILL.md");
      if (!fs.existsSync(file) || seen.has(file)) continue;
      seen.add(file);
      let meta = {};
      try {
        meta = parseFrontmatter(fs.readFileSync(file, "utf8").slice(0, 8000));
      } catch {
        // unreadable skill stays listed by folder name
      }
      skills.push({
        id: `${entry.name}`,
        name: meta.name || entry.name,
        description: meta.description || "",
        path: file,
        root,
      });
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { list, skillRoots };
