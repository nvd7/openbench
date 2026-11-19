// OpenBench engine layer — local skill registration.
//
// Drop folders with a SKILL.md under <OPENBENCH_HOME>/skills and they are added to every
// session through the engine's skill transform. Frontmatter is parsed just enough to get
// name and description; the body is passed through unchanged.
import fs from "node:fs";
import path from "node:path";
import { home } from "./state.mjs";

const MAX_SKILLS = 500;
const MAX_BYTES = 512 * 1024;

export function skillRoot() {
  return path.join(home(), "skills");
}

function parse(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const pair = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (!pair) continue;
      meta[pair[1].toLowerCase()] = pair[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  const body = match ? text.slice(match[0].length) : text;
  const fallback = path.basename(path.dirname(file));
  return {
    id: (meta.id || fallback).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 80),
    name: meta.name || fallback,
    description: meta.description || "",
    path: file,
    content: body.trim(),
  };
}

export function localSkills() {
  const root = skillRoot();
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 4 || found.length >= MAX_SKILLS) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MAX_SKILLS) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (/^skill\.md$/i.test(entry.name)) {
        try {
          if (fs.statSync(full).size > MAX_BYTES) continue;
          const skill = parse(full);
          if (skill.content) found.push(skill);
        } catch (error) {
          console.warn("[openbench-skills]", error?.message || String(error));
        }
      }
    }
  };
  walk(root, 0);
  return found;
}
