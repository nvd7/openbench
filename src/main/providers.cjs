// OpenBench — custom provider CRUD in the upstream opencode.json shape.
const config = require("./config.cjs");

const protocols = {
  "openai-chat": { label: "OpenAI-compatible chat", npm: "@ai-sdk/openai-compatible" },
  "openai-responses": { label: "OpenAI Responses", npm: "@ai-sdk/openai" },
  anthropic: { label: "Anthropic messages", npm: "@ai-sdk/anthropic" },
  gemini: { label: "Gemini", npm: "@ai-sdk/google" },
};

const reserved = new Set(["opencode", "openai", "anthropic", "google", "openrouter", "github-copilot"]);

function safeProvider(id, entry) {
  return {
    id,
    name: entry.name || id,
    npm: entry.npm || "",
    protocol: Object.keys(protocols).find((key) => protocols[key].npm === entry.npm) || "",
    baseURL: entry.options?.baseURL || "",
    hasKey: Boolean(entry.options?.apiKey),
    models: Object.keys(entry.models || {}),
  };
}

function list() {
  const current = config.read();
  return Object.entries(current.provider || {})
    .filter(([id, entry]) => !reserved.has(id) && entry && typeof entry === "object" && entry.npm)
    .map(([id, entry]) => safeProvider(id, entry));
}

function validate(value) {
  if (!value || !/^[a-z][a-z0-9._-]{0,63}$/.test(value.id || "") || reserved.has(value.id)) {
    throw new Error("Use a lowercase custom id, starting with a letter, different from built-in providers.");
  }
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 100) {
    throw new Error("Display name is required (max 100 characters).");
  }
  if (!Object.hasOwn(protocols, value.protocol)) throw new Error("Invalid protocol.");
  let url;
  try {
    url = new URL(value.baseURL);
  } catch {
    throw new Error("Invalid base URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTP(S) URL without credentials, query or fragment.");
  }
  if (value.apiKey !== undefined && (typeof value.apiKey !== "string" || value.apiKey.length > 16000 || /[\r\n]/.test(value.apiKey))) {
    throw new Error("Invalid API key.");
  }
  if (!Array.isArray(value.models) || value.models.length > 500) throw new Error("Provide up to 500 models.");
  const models = [...new Set(value.models.map((item) => (typeof item === "string" ? item.trim() : "")))];
  if (models.some((id) => !id || id.length > 200 || !/^[\w.:/@-]+$/.test(id))) throw new Error("Invalid model ids.");
  return { ...value, name: value.name.trim(), baseURL: url.href.replace(/\/$/, ""), models };
}

function save(input) {
  const value = validate(input);
  const current = config.read();
  current.provider ||= {};
  const before = current.provider[value.id];
  if (before && !before.npm) throw new Error("This id belongs to a different provider type.");
  const npm = protocols[value.protocol].npm;
  const key = value.clearKey ? "" : value.apiKey || before?.options?.apiKey || "";
  const options = { ...(before?.options || {}), baseURL: value.baseURL };
  if (key) options.apiKey = key;
  else delete options.apiKey;
  const models = Object.fromEntries(
    value.models.map((id) => [id, { ...(before?.models?.[id] || {}), name: before?.models?.[id]?.name || id }]),
  );
  current.provider[value.id] = { npm, name: value.name, options, models };
  config.write(current);
  return { ok: true, provider: safeProvider(value.id, current.provider[value.id]), restartRequired: true };
}

function remove(id) {
  if (!list().some((provider) => provider.id === id)) throw new Error("Unknown custom provider.");
  const current = config.read();
  delete current.provider[id];
  config.write(current);
  return { ok: true, restartRequired: true };
}

module.exports = { list, save, remove, protocols, validate };
