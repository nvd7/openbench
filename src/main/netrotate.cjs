// OpenBench — egress identity rotation.
//
// Four modes:
//   off    direct connection, no proxy
//   proxy  an HTTP(S) proxy the user names
//   tor    bundled Tor, HTTP tunnel on 18118, circuit reset via NEWNYM
//   warp   a local WARP/Cloudflare client already listening on 127.0.0.1:40000
//
// The proxy is handed to the engine as HTTPS_PROXY / HTTP_PROXY at spawn time. That
// means a mode change only takes effect after the engine restarts, which is exactly
// what the reset flow does.
const fs = require("node:fs");
const path = require("node:path");
const store = require("./store.cjs");
const tor = require("./tor.cjs");

const WARP_PROXY = "http://127.0.0.1:40000";
const DEFAULTS = { mode: "off", proxyUrl: "", rotations: 0, lastRotation: 0, lastError: null };

function stateFile(userData) {
  return path.join(userData, "rotation", "state.json");
}

function load(userData) {
  return { ...DEFAULTS, ...store.read(stateFile(userData), {}) };
}

/** Resolve the proxy URL for the current mode, starting Tor when needed. */
async function resolveProxy({ userData, settings }) {
  const state = load(userData);
  if (state.mode === "off") return { mode: "off", proxy: null };
  if (state.mode === "tor") {
    const result = await tor.start({ userData, settings });
    return { mode: "tor", proxy: result.proxy };
  }
  if (state.mode === "warp") {
    const open = await tor.portOpen(40000);
    if (!open) throw new Error("nothing is listening on 127.0.0.1:40000 (start your WARP client first)");
    return { mode: "warp", proxy: WARP_PROXY };
  }
  if (state.mode === "proxy") {
    if (!/^https?:\/\//i.test(state.proxyUrl)) throw new Error("proxy URL must start with http:// or https://");
    return { mode: "proxy", proxy: state.proxyUrl };
  }
  throw new Error(`unknown rotation mode: ${state.mode}`);
}

function save(userData, partial) {
  const next = { ...load(userData), ...(partial || {}) };
  const clean = {
    mode: ["off", "proxy", "tor", "warp"].includes(next.mode) ? next.mode : "off",
    proxyUrl: String(next.proxyUrl || ""),
    rotations: Number(next.rotations) || 0,
    lastRotation: Number(next.lastRotation) || 0,
    lastError: next.lastError ? String(next.lastError) : null,
  };
  store.write(stateFile(userData), clean);
  return clean;
}

/** New exit identity. Tor gets a real new circuit; other modes count the restart. */
async function rotate({ userData }) {
  const state = load(userData);
  try {
    if (state.mode === "tor") await tor.rotate();
    return save(userData, {
      rotations: state.rotations + 1,
      lastRotation: Date.now(),
      lastError: null,
    });
  } catch (error) {
    return save(userData, { lastError: error.message, lastRotation: Date.now() });
  }
}

module.exports = { load, save, rotate, resolveProxy, stateFile, WARP_PROXY };
