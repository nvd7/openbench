// OpenBench — MCP server CRUD in opencode.json and connection probes through the running server.
const config = require("./config.cjs");

function list() {
  const current = config.read();
  return Object.entries(current.mcp || {})
    .filter(([, value]) => value && typeof value === "object")
    .map(([name, value]) => ({
      name,
      type: value.type,
      enabled: value.enabled !== false,
      command: value.command || null,
      url: value.url || null,
    }));
}

function validate(name, value) {
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(name)) throw new Error("Invalid MCP name.");
  if (!value || !["local", "remote"].includes(value.type)) throw new Error("MCP type must be local or remote.");
  if (value.type === "local") {
    if (!Array.isArray(value.command) || value.command.length === 0 || value.command.some((part) => typeof part !== "string" || part.length > 4096)) {
      throw new Error("command must be a non-empty array of strings.");
    }
  } else {
    let url;
    try {
      url = new URL(value.url);
    } catch {
      throw new Error("Invalid remote URL.");
    }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Use an HTTP(S) URL without credentials.");
  }
  for (const key of ["environment", "headers"]) {
    if (value[key] && !Object.values(value[key]).every((item) => typeof item === "string")) {
      throw new Error(`${key} values must be strings.`);
    }
  }
  return value;
}

function save(name, value) {
  validate(name, value);
  const current = config.read();
  current.mcp ||= {};
  current.mcp[name] = value;
  config.write(current);
  return { ok: true, restartRequired: true };
}

function remove(name) {
  const current = config.read();
  if (!current.mcp || !current.mcp[name]) throw new Error("MCP server is not configured.");
  delete current.mcp[name];
  config.write(current);
  return { ok: true, restartRequired: true };
}

module.exports = { list, save, remove, validate };
