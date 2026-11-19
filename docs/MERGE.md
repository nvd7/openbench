# Engine layer

The TokenCode feature set is not UI-only. Auto-JB, the compaction policy and bundled
skills live in an engine plugin; the desktop window is a client. OpenBench ships the same
shape: one small ESM bundle in `resources/engine/`, loaded by any OpenCode 2.x engine that
honours `plugins` in config.

## Why a plugin instead of `instructions`

`instructions` is read while a session is built. Editing the brief mid-session changes
nothing until a new session starts. The plugin pushes the brief into the `system` array on
every request-building hook, so the next turn sees the current text. It also removes its
own previous entry first, so repeated hooks never stack duplicate briefs.

`compaction.auto` is set to `false` for the engine's own trigger. The plugin owns
compaction instead: on `experimental.idle`, if the last assistant message used 75% of the
model's input budget, it asks the engine to compact once.

## Files

| File | Role |
|---|---|
| `openbench-plugin.mjs` | entry point; registers hooks and disposes them |
| `state.mjs` | reads `OPENBENCH_HOME/autojb/state.json` and the brief file |
| `policy.mjs` | token accounting and the idle compactor |
| `skills.mjs` | registers `OPENBENCH_HOME/skills/**/SKILL.md` |

`OPENBENCH_HOME` defaults to `%LOCALAPPDATA%\OpenBench` and is set explicitly by the app
when it spawns the engine. The merge installer uses the same directory, so edits made in
OpenBench also reach an OpenCode started outside it.

## Install paths

There are two consumers of the layer:

1. **OpenBench's own engine.** The app writes the plugin entry and `compaction.auto = false`
   into `OPENCODE_CONFIG_CONTENT` at spawn. The user's `opencode.json` is not touched.
2. **The installed OpenCode.** Settings → Merge copies the layer to
   `%LOCALAPPDATA%\OpenBench\engine` and writes one `plugins` entry plus
   `compaction.auto = false` into the global `opencode.json`. A timestamped backup is taken
   before the file is replaced; Remove deletes the entry, restores the previous
   `compaction.auto` from `%LOCALAPPDATA%\OpenBench\merge.json`, and leaves unrelated
   plugins alone.

The layer is read when an engine process starts. Restart OpenCode after install/remove.

## State

`%LOCALAPPDATA%\OpenBench\autojb\state.json`:

```json
{
  "enabled": true,
  "compactionAuto": true,
  "customText": ""
}
```

`customText` wins when non-empty; otherwise the plugin reads
`autojb/instructions.md`, which the app regenerates from the shipped default or the user's
text. Both are editable outside the app; the next request uses the new value.

## Local skills

Any folder under `%LOCALAPPDATA%\OpenBench\skills` with a `SKILL.md` is registered through
the engine's skill transform. Frontmatter `name` and `description` are parsed; the body is
passed through. Limits: 500 skills, 512 KB per file, recursion depth 4.

## Compatibility

- Engine 2.3.0: `plugins` accepts an absolute path without an extension; Bun resolves the
  `.mjs` file. This is the same mechanism TokenCode uses
  (`...\usage-reset\autojb-plugin` → `autojb-plugin.mjs`).
- Hook names used here: `context`, `compaction`, `generate`, `experimental.idle`, plus
  `skill.transform`. They are the contract TokenCode's `autojb-plugin.mjs` targets on the
  same engine build.
- If a hook is missing, the plugin logs and continues; a partial engine never blocks
  startup.
- The plugin has no package dependencies and does not import Electron.
