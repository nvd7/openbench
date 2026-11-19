// OpenBench engine layer — context policy.
//
// The engine's built-in compaction is switched off in config so it cannot summarise a
// transcript mid-turn. This hook owns the decision instead: on session idle, if the last
// assistant message used at least THRESHOLD of the model's input budget, ask the engine
// to compact once. `attempted` prevents the idle event from enqueueing the same summary
// twice.
//
// Per-session policy lives in OPENBENCH_HOME/context/sessions.json:
//   { "ses_...": { "auto": true, "threshold": 75, "window": 100 } }
// `window` scales the usable budget: 75 means compact when the transcript fills 75% of
// the model window. `threshold` is when to act inside that window.
import fs from "node:fs";
import path from "node:path";
import { readState, home } from "./state.mjs";

export const THRESHOLDS = [25, 50, 65, 75, 80, 95];
export const WINDOWS = [25, 50, 75, 100];
export const DEFAULT_POLICY = { auto: true, threshold: 75, window: 100 };

function policyDir() {
  return path.join(home(), "context");
}

function policyFile() {
  return path.join(policyDir(), "sessions.json");
}

export function readPolicies() {
  try {
    const value = JSON.parse(fs.readFileSync(policyFile(), "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function writePolicies(value) {
  fs.mkdirSync(policyDir(), { recursive: true });
  const temp = `${policyFile()}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temp, policyFile());
  return value;
}

export function normalizePolicy(value = {}) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    auto: typeof raw.auto === "boolean" ? raw.auto : DEFAULT_POLICY.auto,
    threshold: THRESHOLDS.includes(raw.threshold) ? raw.threshold : DEFAULT_POLICY.threshold,
    window: WINDOWS.includes(raw.window) ? raw.window : DEFAULT_POLICY.window,
  };
}

export function readPolicy(sessionID) {
  const all = readPolicies();
  return normalizePolicy(sessionID ? all[sessionID] : null);
}

export function writePolicy(sessionID, patch) {
  if (typeof sessionID !== "string" || !/^ses_[a-zA-Z0-9]{1,100}$/.test(sessionID)) {
    throw new Error("invalid session id");
  }
  const all = readPolicies();
  all[sessionID] = normalizePolicy({ ...readPolicy(sessionID), ...(patch || {}) });
  writePolicies(all);
  return all[sessionID];
}

export function usageTotal(tokens) {
  if (!tokens || typeof tokens !== "object") return 0;
  const direct = ["input", "output", "reasoning"].reduce((sum, key) => sum + (Number(tokens[key]) || 0), 0);
  const cache = Number(tokens.cache?.read) || 0;
  const cacheWrite = Number(tokens.cache?.write) || 0;
  return Math.max(0, direct + cache + cacheWrite);
}

function modelLimit(model) {
  const context = Number(model?.limit?.context) || 0;
  const input = Number(model?.limit?.input) || 0;
  if (input > 0 && context > 0) return Math.min(input, context);
  return input || context || 0;
}

export function shouldCompact(total, limit, policy) {
  if (!limit || limit <= 0) return false;
  const usable = limit * ((policy?.window ?? 100) / 100);
  const trigger = usable * ((policy?.threshold ?? 75) / 100);
  return total >= trigger;
}

export function createCompactor(context) {
  const attempted = new Map();
  const running = new Set();

  return async function compactWhenFull(event) {
    if (!event || typeof event.sessionID !== "string") return;
    if (running.has(event.sessionID) || (Array.isArray(event.background) && event.background.length)) return;
    if (!readState().compactionAuto) return;

    const policy = readPolicy(event.sessionID);
    if (!policy.auto) return;

    running.add(event.sessionID);
    try {
      const response = await context.session.context({ sessionID: event.sessionID });
      const messages = Array.isArray(response) ? response : response?.data || [];
      const last = messages.findLast?.((item) => item.type === "assistant" && item.tokens)
        || [...messages].reverse().find((item) => item.type === "assistant" && item.tokens);
      if (!last || last.error) return;
      if (attempted.get(event.sessionID) === last.id) return;

      const catalog = await context.model.list();
      const models = Array.isArray(catalog) ? catalog : catalog?.data || [];
      const model = models.find(
        (item) => item.providerID === last.model?.providerID && item.id === last.model?.id,
      );
      const limit = modelLimit(model);
      if (!limit) return;

      if (!shouldCompact(usageTotal(last.tokens), limit, policy)) return;

      // Mark before admission: a slow summary must not be re-requested by the next idle.
      attempted.set(event.sessionID, last.id);
      if (attempted.size > 2000) attempted.delete(attempted.keys().next().value);
      await context.session.compact({ sessionID: event.sessionID });
    } catch (error) {
      console.error("[openbench-context]", error?.message || String(error));
    } finally {
      running.delete(event.sessionID);
    }
  };
}

/** Compact now, bypassing the policy — used by the app's "Compact" button. */
export async function compactNow(context, sessionID) {
  await context.session.compact({ sessionID });
  return true;
}
