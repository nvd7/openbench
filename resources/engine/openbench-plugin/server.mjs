// OpenBench engine layer — plugin entry point.
//
// Loaded by the engine with `plugins: ["<path>/openbench-plugin"]` — the engine requires a
// directory with a package.json whose `exports` points at server.mjs. It owns four
// behaviours that config alone cannot express:
//
//   1. Auto-JB  — the standing brief (or the profile bound to the session/project) is
//      pushed into the system array per request, so edits apply to the next turn.
//   2. Compaction — the engine's own auto compaction is off; this plugin compacts on
//      idle at the session's threshold (default 75% of the model budget).
//   3. Skills — SKILL.md folders under OPENBENCH_HOME/skills are registered natively.
//   4. Diagnostics — every request decision is appended to autojb/requests.jsonl.
//
// Every registration is disposed in the returned function; the engine calls it when the
// plugin is unloaded.
import fs from "node:fs";
import path from "node:path";
import { readState, readBrief, autojbDir } from "./state.mjs";
import { createCompactor } from "./policy.mjs";
import { localSkills } from "./skills.mjs";

const MARKER = "openbenchAutoJb";
const LOG_LIMIT = 4 * 1024 * 1024;

function inject(event, text) {
  const system = Array.isArray(event?.system) ? event.system : null;
  if (!system) return false;
  for (let index = system.length - 1; index >= 0; index -= 1) {
    if (system[index]?.metadata?.[MARKER] === true) system.splice(index, 1);
  }
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  system.push({ type: "text", text: trimmed, metadata: { [MARKER]: true } });
  return true;
}

/** Scope for a session: its id and project directory, resolved from the engine. */
function scopeReader(context) {
  return async (event) => {
    const scope = { sessionID: typeof event?.sessionID === "string" ? event.sessionID : "" };
    if (!scope.sessionID || typeof context.session?.get !== "function") return scope;
    try {
      const info = await context.session.get({ sessionID: scope.sessionID });
      const data = info?.data || info;
      scope.directory = data?.location?.directory || data?.directory || "";
    } catch {
      // A missing session only costs the project-level profile, not the request.
    }
    return scope;
  };
}

/** Append-only diagnostic log, rotated at LOG_LIMIT so it cannot grow forever. */
function log(line) {
  try {
    const dir = autojbDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "requests.jsonl");
    try {
      if (fs.statSync(file).size > LOG_LIMIT) fs.renameSync(file, `${file}.1`);
    } catch {
      // first write
    }
    fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`);
  } catch {
    // diagnostics never break a request
  }
}

export default {
  id: "openbench.auto-jb",
  async setup(context) {
    const registrations = [];
    const register = async (name, handler) => {
      try {
        if (typeof context.session?.hook !== "function") return;
        registrations.push(await context.session.hook(name, handler));
      } catch (error) {
        console.error("[openbench-hook]", name, error?.message || String(error));
      }
    };

    const scopeFor = scopeReader(context);

    // The brief has to land on every request-building hook; the engine uses different
    // names depending on what it is assembling (turn, summary, bare generation).
    for (const name of ["context", "compaction", "generate"]) {
      await register(name, async (event) => {
        const state = readState();
        if (!state.enabled) return false;
        const scope = await scopeFor(event);
        const brief = readBrief(state, scope);
        const applied = inject(event, brief);
        log({
          stage: name,
          sessionID: scope.sessionID || null,
          directory: scope.directory || null,
          enabled: state.enabled,
          applied,
          characters: applied ? brief.trim().length : 0,
          model: event?.model?.modelID || event?.model?.id || null,
          provider: event?.model?.providerID || null,
        });
        return applied;
      });
    }

    await register("experimental.idle", createCompactor(context));

    try {
      if (typeof context.skill?.transform === "function") {
        registrations.push(
          await context.skill.transform((editor) => {
            for (const skill of localSkills()) editor.add(skill);
          }),
        );
      }
    } catch (error) {
      console.error("[openbench-skills]", error?.message || String(error));
    }

    return async () => {
      for (const registration of registrations) {
        try {
          await registration?.dispose?.();
        } catch {
          // disposal is best effort; the process is usually exiting anyway
        }
      }
    };
  },
};
