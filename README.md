# OpenBench

A desktop workbench around the [OpenCode](https://opencode.ai) coding agent. Chat UI, provider manager, MCP
manager, skill browser and a curated tool catalog — packaged as an Electron app.

OpenBench is an independent, MIT-licensed reimplementation inspired by the architecture of TokenCode. It is not
affiliated with TokenCode, its authors, or the OpenCode project.

## What it does

- **Local-first sessions.** The app spawns `opencode serve` on loopback and talks to it over HTTP + SSE. Nothing is
  proxied through a third-party service.
- **Streaming chat.** Message parts, tool calls and reasoning render live as the agent works.
- **Model picker.** Every provider and model reported by the running OpenCode server.
- **Provider manager.** Adds custom OpenAI-compatible, OpenAI Responses, Anthropic and Gemini providers to the global
  `opencode.json`.
- **MCP manager.** Registers stdio and remote MCP servers, probes connections through the server, removes them.
- **Skills browser.** Lists `SKILL.md` packages from the standard OpenCode/agents folders.
- **Tool catalog.** Curated GitHub links with shallow clone into the user data folder. Cloning never installs or
  executes anything.
- **Auto-JB.** A standing brief injected by an engine plugin on every request, so edits apply to the next turn. The
  engine's automatic compaction is switched off and the plugin compacts on idle at 75% of the model budget. Your
  `opencode.json` is never modified by the app's own engine; the override lives only for the engine process it spawns.
- **Merge.** One button writes the same layer into the global `opencode.json`, so an OpenCode started outside
  OpenBench gets the same brief, compaction policy and local skills. Timestamped backup, exact uninstall.
- **Maintenance / reset.** Egress rotation (direct, custom HTTP proxy, bundled Tor with circuit reset, or a local
  WARP client), SQLite session snapshots with SHA-256 manifests and 5-deep retention, and a one-click reset that
  stops the engine, snapshots, rotates, restarts and probes.
- **Three themes.** Sombra (default), Graphite, Paper.

## Requirements

- Windows 10/11 x64 (the UI also builds on macOS/Linux).
- Node.js 20+ for development.
- An `opencode` binary on `PATH`, or set the CLI path in Settings. `npm i -g opencode-ai` installs one.

## Run

```bash
npm install
npm run dev      # builds and launches Electron
```

Production bundle:

```bash
npm run dist     # portable exe in dist/
```

## How it fits together

```
Electron main                     OpenCode server (child process)
┌──────────────────────┐          ┌──────────────────────────────┐
│ settings.cjs         │          │ POST /session                │
│ server.cjs ──────────┼─ HTTP ──▶│ GET  /session/:id/message    │
│ providers.cjs        │          │ POST /session/:id/prompt_async│
│ mcp.cjs              │          │ GET  /event (SSE)            │
│ catalog.cjs          │          └──────────────────────────────┘
└──────┬───────────────┘
       │ IPC (contextBridge)
┌──────▼───────────────┐
│ renderer/app.js      │
│ index.html / style   │
└──────────────────────┘
```

The renderer has no Node access. Everything goes through the preload bridge.

## Repository layout

```
src/main/        Electron main process, server supervisor, config editors
src/preload/     contextBridge surface
src/renderer/    plain HTML/CSS/JS UI (no framework, no remote code)
resources/       tool catalog shipped with the app
scripts/         esbuild build and dev launcher
docs/            architecture and TokenCode analysis
```

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, no remote module.
- Renderer CSP blocks remote scripts and connections; all server traffic stays in the main process.
- Session messages are escaped before rendering. Markdown supports code, emphasis and http(s) links only.
- MCP and provider edits are written with a backup of the previous `opencode.json`.

## License

MIT. See `LICENSE`.
