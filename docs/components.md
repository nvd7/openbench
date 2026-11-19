# TokenCode — mapa de componentes proprietários

Referência: `packages\054f40851a669a525d96\app\resources\`.

## `toolkit\` — camada de UI (renderer + main)

| Arquivo | Papel |
|---|---|
| `desktop-ipc-main.mjs` | Cria um `MessageChannel` por documento carregado, entrega `port2` ao renderer via `postMessage("desktop-rpc-port", null, [port])`. Reemite em `did-navigate`/`did-finish-load`. Só entrega se `isAllowed(url)`. |
| `desktop-ipc-preload.mjs` | Ponte do preload: valida origem, expõe métodos restritos ao contexto isolado. |
| `panel.js` | Painel "Tools" no Settings: busca no catálogo, baixa/clona repositórios, abre pastas. |
| `catalog.json` | 200+ entradas `{category, owner, repo, url}` — RE, kernel, hooking, evasion, redteam, AD, C2, web, LLM, etc. |
| `service.mjs` | Backend do catálogo: normaliza repos, mescla entradas de MCP e skills empacotadas, faz `git clone --depth 1` em `%LOCALAPPDATA%\TokenCode\tools\repositories\<owner>--<repo>`. |
| `maintenance.js/.css` | Tela de manutenção: limpar cache, recriar DB, resetar config, exportar diagnóstico. |
| `updates.js/.css` | Tela de atualização: consulta releases, baixa instalador, verifica assinatura. |
| `context-panel.js` | Editor de contexto/instruções extras por sessão. |
| `discord-profile.js` | Card de perfil Discord (avatar, guild, status). |
| `anime.js` | Assets e animação de fundo (tema Sombra). |
| `session-layout.js/.css` | Ajustes de layout do chat (largura, densidade). |
| `companion.js` | Widget flutuante (companion runner). |
| `appearance.css` | Overrides de tema por cima do CSS do OpenCode. |

Fluxo do catálogo:

```
renderer (panel.js)  →  rpc "catalog:list"      → service.mjs
                     →  rpc "catalog:clone"     → git clone --depth 1
                                                → %LOCALAPPDATA%\TokenCode\tools\repositories\
```

## `usage-reset\` — orquestração proprietária (Node 22+)

| Arquivo | Papel |
|---|---|
| `reset.mjs` | Coordenador de reset: probe de modelo, rotação de identidade de rede (Tor/WARP/proxy), reinício da engine, renovação de sessão. Grava logs em `TRACE`. |
| `reset-settings.mjs` | Lê modo de reset (off/manual/auto) das settings. |
| `infinite.mjs` | Porte de "OpenCode Infinite.bat": rotação WARP (`127.0.0.1:40000`), Tor (`19050/19051/18118`), backup rotativo (`KEEP_BACKUPS = 5`). |
| `socks-bridge.mjs` | Bridge SOCKS5→HTTP para o engine. |
| `tor-service.mjs` | Sobe/derruba `tor.exe` portátil, controla circuitos. |
| `probe.mjs` | Healthcheck de modelo/provider. |
| `autojb-config.mjs` | Injeta o plugin `autojb-plugin` no `OPENCODE_CONFIG_CONTENT` e força `compaction.auto = false`. |
| `autojb-plugin.mjs` | Plugin de sessão: aplica o texto padrão do Auto JB, gerencia estado. |
| `autojb-default.txt` | 96 KB de texto de instruções padrão (o "Auto JB"). |
| `autojb-state.mjs` / `autojb-state` | Persistência do estado (ligado/desligado, perfil). |
| `backup.mjs` | Snapshots SQLite consistentes (`node:sqlite` `backup()`), arquivos fixos + preferências, hash SHA-256, zip gzip. |
| `recovery-worker.mjs` | Recuperação pós-crash: valida DB, restaura backup. |
| `diagnostic-export.mjs` | Exporta relatório sem chaves/conversas (paths, versões, hashes, logs). |
| `custom-providers.mjs` | CRUD de providers no formato nativo do OpenCode (`openai-chat`, `openai-responses`, `anthropic`, `gemini`; pacotes `@opencode/ai/providers/*`). |
| `mcp-manager.mjs` | CRUD de MCP local/remoto + status. |
| `instruction-profiles.mjs` | Perfis de instruções (troca de persona/system prompt por perfil). |
| `bundled-skills.mjs` | Descobre os `SKILL.md` em `bundled-skills\cassandra`. |
| `companion.mjs` / `companion-runner.mjs` | Processo companion (widget). |
| `context-policy.mjs` / `context-state.mjs` | Política de contexto: truncamento, prioridade, estado por sessão. |
| `windows-shell.mjs` | Resolve shell padrão no Windows (PowerShell/cmd) para o engine. |
| `build-info.mjs` | Versão/commit do build. |
| `tokeninf-service.mjs` | Serviço de "token info" (proxy de contagem/limites). |
| `infinite.reference.ts` | Referência TS do porte. |

## `bundled-skills\cassandra\`

~200 `SKILL.md` cobrindo: recon, web (SQLi, XSS, SSTI, SSRF, JWT, OAuth, smuggling, cache poisoning,
race conditions), AD (Kerberoasting, AS-REP, DCSync, ADCS ESC1, relay, coercion, LAPS), cloud
(AWS IAM privesc, Entra ID, GCP impersonation, K8s), container escapes, C2 (Sliver, Mythic, Havoc,
Cobalt Strike), pós-exploração, mobile (Android/iOS/Flutter/IL2CPP), wireless, ICS/OT, contratos
(Solidity), LLM red team (AATMF T1–T15), DFIR, reversing, firmware, YARA, OSINT, phishing, soundwave
(ROE/ConOps/cleanup), adversary emulation (APT28/29/41, Lazarus, Sandworm, Volt Typhoon, Scattered
Spider, etc.).

Cada skill segue o formato OpenCode: frontmatter `name`/`description` + corpo em Markdown.

## `capri-upstream\`

Chat independente ("Capri"). Mantém o próprio store (`local\capri-chat\chat.json`) e arquivo rotativo
(`archive\chat-*.json`). Separado do chat principal — não compartilha sessão nem tools.

## `tor\`

Binário Tor portátil + config. Usado apenas pelo `infinite.mjs` quando o modo de rotação exige.

## `opencode-cli.exe`

Engine compilada com Bun (`opencode-cli.version` = `2.3.0`). O comportamento observado corresponde ao
OpenCode CLI: `serve --hostname --port`, REST + SSE, SQLite em `local\data\opencode.db`, plugins via
`OPENCODE_CONFIG_CONTENT`.
