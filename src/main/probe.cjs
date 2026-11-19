// OpenBench — engine health probe.
//
// The probe is deliberately cheap: it asks the engine what it can see rather than
// generating a completion. A provider whose credentials expired still lists models,
// so the probe also reports how many models the engine considers usable and which
// providers are active.
const TIMEOUT_MS = 8000;

async function probe(server) {
  const started = Date.now();
  try {
    const models = await server.request("GET", "/model", undefined, { timeout: TIMEOUT_MS });
    const list = Array.isArray(models) ? models : [];
    let providers = [];
    try {
      providers = await server.request("GET", "/provider", undefined, { timeout: TIMEOUT_MS });
    } catch {
      providers = [];
    }
    const active = (Array.isArray(providers) ? providers : []).filter(
      (provider) => provider.activation !== "disabled" && provider.activation !== "failed",
    );
    return {
      ok: list.length > 0,
      latencyMs: Date.now() - started,
      models: list.length,
      providers: active.length,
      providerIDs: active.map((provider) => provider.id),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      models: 0,
      providers: 0,
      providerIDs: [],
      error: error.message,
    };
  }
}

module.exports = { probe };
