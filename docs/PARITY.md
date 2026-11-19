# OpenBench vs. TokenCode — o que foi clonado

OpenBench é uma reimplementação limpa (MIT) da **arquitetura** do TokenCode, não do binário. Nada foi
copiado do ASAR: os módulos foram reescritos a partir do comportamento observado na análise estática.

## Paridade funcional

| Recurso do TokenCode | OpenBench | Nota |
|---|---|---|
| Shell Electron + engine sidecar | ✅ | `src/main/server.cjs` spawna `opencode serve` em porta livre |
| Chat com streaming (SSE) | ✅ | `/event` lido no main, repassado por IPC |
| Lista/criação/exclusão de sessões | ✅ | REST `/session*` |
| Seletor de modelo (todos os providers) | ✅ | lê `/config/providers` |
| Custom providers (OpenAI chat/responses, Anthropic, Gemini) | ✅ | grava em `opencode.json` global |
| Gerenciador MCP (local/remoto) | ✅ | CRUD + probe via `/mcp` |
| Lista de skills instaladas | ✅ | varre pastas padrão por `SKILL.md` |
| Catálogo de ferramentas + clone | ✅ | `resources/catalog.json` curado, `git clone --depth 1` |
| Temas | ✅ 3 | Sombra, Graphite, Paper (Sombra = tema escuro padrão) |
| Painel de diagnóstico | ✅ | About mostra versões, paths, config |
| Backup automático | ✅ | `backup.cjs` — db+wal+shm, SHA-256, gzip, retenção 5 |
| Tor/WARP rotation | ✅ | `netrotate.cjs` + `tor.cjs` — off / proxy / tor / warp |
| Auto-JB | OK | plugin de engine: brief aplicado por request, edicao vale no proximo turno |
| `compaction.auto = false` | OK | plugin compacta no idle em 75% do budget do modelo |
| Reset coordenado | OK | `reset.cjs` - stop > snapshot > rotate > start > probe |
| Perfis de instrucao por projeto | OK | profiles.cjs + profiles.json: perfis nomeados, binding por sessao/projeto/default |

| Context policy por sessao | OK | contextpolicy.cjs + context/sessions.json: auto/threshold/window |
| Log de requests | OK | utojb/requests.jsonl com rotacao em 4 MB |
| Discord OAuth gate | ❌ | decisão: app local sem gate de terceiros |
| Capri chat | ❌ | app separado no TokenCode |
| Anime/cursor/tema animado | ❌ | assets proprietários |
| Updates assinados | ⚠️ | electron-builder presente; sem servidor de release configurado |

## O que muda de propósito

1. **Sem gate.** O app abre e funciona. Nenhum OAuth, nenhum guild, nenhum cache de licença.
2. **Auto-JB é opcional e visível.** O brief injetado aparece na aba Auto-JB, é editável e pode ser desligado —
   diferente do TokenCode, onde o texto vive num `.txt` de 96 KB dentro do pacote.
3. **Rotação é escolha explícita.** Direct por padrão; Tor, WARP e proxy só entram quando você seleciona o modo
   e roda um reset. Nada sobe `tor.exe` pelas costas.
4. **Catálogo curado e menor.** 45 entradas com descrição, em vez de 200+ sem contexto. Mesmo mecanismo
   de clone, mesma pasta (`%APPDATA%\OpenBench\tools\repositories`).
5. **Escrita de config com backup.** Toda edição de `opencode.json` cria `*.before-openbench-<ts>` antes
   de substituir atomicamente.
6. **Snapshot antes de cada reset.** O TokenCode faz backup rotativo; aqui o snapshot é parte do ciclo de reset,
   com SHA-256 por arquivo e restauração pela UI.

## O que foi mantido igual (porque é o que funciona)

- Engine como processo filho, nunca embutida. O app é um cliente; o agente é a engine.
- REST + SSE como único protocolo entre UI e agente.
- Renderer sem Node, preload estreito, CSP fechada.
- Config do OpenCode como fonte de verdade para providers e MCP — nada de banco paralelo.

## Estrutura

```
src/main/
  index.cjs       Electron main, janela, IPC
  server.cjs      supervisão da engine + cliente REST/SSE
  settings.cjs    settings.json atômico em userData
  config.cjs      opencode.json global (com backup)
  providers.cjs   CRUD de providers
  mcp.cjs         CRUD de MCP
  skills.cjs      descoberta de SKILL.md
  catalog.cjs     catálogo + clone
src/preload/index.cjs
src/renderer/     index.html, style.css, app.js (sem framework)
resources/catalog.json
scripts/build.mjs, dev.mjs
```

## Licença e atribuição

OpenBench é MIT. O OpenCode é MIT (`https://github.com/sst/opencode`). O TokenCode não publica licença
do código proprietário; este projeto não reutiliza nenhuma linha dele.
