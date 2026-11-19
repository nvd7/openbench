// OpenBench — the "usage reset" coordinator.
//
// What TokenCode calls a reset is three operations in a fixed order:
//
//   1. stop the engine          (writer quiet, database copyable)
//   2. snapshot the session db  (rollback point if the next start is bad)
//   3. change egress identity   (new Tor circuit, or a different proxy)
//   4. start the engine again   (new connection pool, new process)
//   5. probe                    (is it actually usable)
//
// Everything is sequential on purpose. A reset that overlaps its own restart is a
// reset that leaves two engines holding the same SQLite file.
const backup = require("./backup.cjs");
const netrotate = require("./netrotate.cjs");
const { probe } = require("./probe.cjs");

const log = [];

function record(step, status, detail) {
  const entry = { at: Date.now(), step, status, detail: detail ? String(detail) : null };
  log.push(entry);
  if (log.length > 200) log.shift();
  return entry;
}

function history() {
  return log.slice(-60);
}

/**
 * Run one reset cycle. `start` is the same function the UI calls to boot the engine,
 * so the caller keeps ownership of ports, cwd, and config overrides.
 */
async function run({ server, userData, settings, start, skipBackup = false }) {
  const report = { startedAt: Date.now(), steps: [], ok: false, error: null };
  const push = (step, status, detail) => {
    report.steps.push(record(step, status, detail));
  };

  try {
    push("stop", "running");
    await server.stop();
    push("stop", "ok");

    if (!skipBackup) {
      push("backup", "running");
      try {
        const snap = await backup.snapshot(userData, { reason: "reset" });
        if (snap.skipped) push("backup", "skipped", snap.reason);
        else push("backup", "ok", `${snap.id} (${snap.files.length} files, pruned ${snap.removed.length})`);
      } catch (error) {
        // A failed snapshot must not block the reset; it is a rollback aid, not a gate.
        push("backup", "error", error.message);
      }
    }

    push("rotate", "running");
    let proxy = null;
    try {
      const resolved = await netrotate.resolveProxy({ userData, settings });
      proxy = resolved.proxy;
      await netrotate.rotate({ userData });
      const state = netrotate.load(userData);
      push("rotate", "ok", `${resolved.mode}${proxy ? ` via ${proxy}` : " (direct)"} · rotation #${state.rotations}`);
    } catch (error) {
      push("rotate", "error", error.message);
      // Direct connection is the safe fallback: a broken proxy would make every
      // provider call fail, which is worse than keeping the old egress identity.
      proxy = null;
    }

    push("start", "running");
    server.proxy = proxy;
    const status = await start();
    push("start", status.state, status.url || status.error || "");

    push("probe", "running");
    const health = await probe(server);
    push("probe", health.ok ? "ok" : "error", `${health.models} models in ${health.latencyMs}ms${health.error ? ` · ${health.error}` : ""}`);

    report.ok = status.state === "running" && health.ok;
    report.error = report.ok ? null : health.error || status.error || "engine did not come back healthy";
  } catch (error) {
    report.error = error.message;
    push("fatal", "error", error.message);
  }

  report.finishedAt = Date.now();
  report.durationMs = report.finishedAt - report.startedAt;
  return report;
}

module.exports = { run, history };
