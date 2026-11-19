# TokenCode 1.1.0 — análise estática

> Alvo: `%LOCALAPPDATA%\TokenCode\packages\054f40851a669a525d96` (build em execução).
> Data: 18/11/2026. Método: inspeção do ASAR (REA JavaScript application analyzer), leitura dos módulos
> desempacotados em `resources\`, SHA-256 e observação de processos. Nada do alvo foi executado pela análise.

## 1. Identidade

| Artefato | Tamanho | SHA-256 |
|---|---|---|
| `app\tokencode Dev.exe` | 246,6 MB | `97519CB44B5ED40A2A3D6F1E88F9178F4234673932BC45153FDB964A879DDD0C` |
| `app\resources\app.asar` | 252,1 MB (11.877 entradas) | `20F5F8AAA5F799BE41976D8D0BEC7E091D0F0005FBAFB52F6D98AD3A904DDBF0` |
| `app\resources\opencode-cli.exe` | 257,5 MB, v2.3.0 | `F1AACB96863CEA80E84020FF3E53C9F6831F444EF68E7E57AEF08D27FEE09BED` |
| `runtime\node.exe` | 100 MB | — (Node v26.13.0) |

O `package.json` dentro do ASAR declara `"name": "@opencode/desktop"`, `"version": "1.1.0"`, licença MIT,
homepage `https://opencode.ai`. Conclusão direta: **TokenCode é um fork/rebrand do OpenCode Desktop**
(Electron + Bun engine), com uma camada proprietária adicionada em `resources\toolkit\` e
`resources\usage-reset\`.

## 2. Distribuição

`resources\distribution.json`:

```json
{
  "version": "1.1.0",
  "repository": "BlackLiztZ/TOKENCODE-releases",
  "publicKey": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAvvNw3708ewJW80bOhw9CgFvonmX9eV+zyS7j6yS71gY=\n-----END PUBLIC KEY-----\n",
  "discord": {
    "enabled": true,
    "clientId": "1561196392670564362",
    "guildId": "1560730077216636928",
    "guildName": "TokenBypass",
    "inviteUrl": "https://discord.com/invite/AswbBqPyY",
    "redirectUri": "http://127.0.0.1:39473/discord/callback"
  }
}
```

- Atualizações vêm de um repositório GitHub separado (`TOKENCODE-releases`), não do código-fonte.
- O instalador é validado por assinatura **Ed25519** (chave pública acima) + SHA-256.
- O gate de acesso é OAuth2 Discord com verificação de presença no guild `TokenBypass`, escopo mínimo
  (`identify`, `guilds`), redirect em loopback `127.0.0.1:39473`.

## 3. Layout em disco

```
%LOCALAPPDATA%\TokenCode\
├─ packages\
│  ├─ 054f40851a669a525d96\      ← 1.1.0 (em execução)
│  └─ a5817788c852fd7d39c1\      ← 1.0.8 (anterior, mantida pelo updater)
└─ (dados do usuário em %APPDATA%\TokenCode\
   ├─ local\data\opencode.db     ← SQLite de sessões
   ├─ profile\opencode.settings
   ├─ local\context\sessions.json
   ├─ local\autojb\
   └─ gh\, discord\, Cache\, GPUCache\, ...
```

Dentro de `app\resources\`:

```
app.asar               ← OpenCode Desktop (main/preload/renderer compilados)
app.asar.unpacked\     ← módulos nativos (.node)
toolkit\               ← UI proprietária injetada (painéis, catálogo, manutenção, anime, updates)
usage-reset\           ← orquestração: engine spawn, backups, Tor/WARP rotation, auto-JB, Discord
bundled-skills\cassandra\ ← ~200 SKILL.md (playbooks de segurança ofensiva/defensiva)
capri-upstream\        ← chat secundário "Capri"
tor\                   ← binário Tor portátil
opencode-cli.exe       ← engine (fork do OpenCode CLI v2.3.0)
```

## 4. Como as camadas conversam

```
Electron main (app.asar/out/main/index.js)
  ├─ cria BrowserWindow, injeta toolkit/*.js no renderer
  ├─ spawna opencode-cli.exe serve --port=N  (sidecar)
  └─ RPC autenticado com o renderer via MessagePort
       toolkit/desktop-ipc-main.mjs  →  postMessage("desktop-rpc-port")
       toolkit/desktop-ipc-preload.mjs →  expõe API restrita

opencode-cli (engine)
  ├─ REST + SSE em 127.0.0.1
  ├─ tools, providers, MCP, sessions (SQLite)
  └─ plugins carregados por OPENCODE_CONFIG_CONTENT
```

O toolkit não substitui o frontend do OpenCode: ele **injeta** painéis por cima (Settings → Tools,
Maintenance, Updates) e intercepta o bootstrap do config para registrar o plugin `autojb-plugin`
e desligar a compactação automática (`compaction.auto = false`).

## 5. O que é código original do OpenCode vs. camada TokenCode

| Componente | Origem |
|---|---|
| Chat, sessões, tools, providers, MCP, agentes, skills engine | OpenCode Desktop / opencode-cli |
| Tema, layout, atalhos | OpenCode Desktop |
| Catálogo de ferramentas (`toolkit/catalog.json`, 200+ repos) | TokenCode |
| Painel Maintenance, Updates, backup, diagnóstico | TokenCode |
| `usage-reset/*` (reset coordinator, Tor, WARP, auto-JB) | TokenCode |
| Discord OAuth + guild gate | TokenCode |
| `bundled-skills/cassandra/*` (~200 playbooks) | TokenCode |
| Capri (chat independente) | TokenCode (upstream separado) |
| Anime assets, cursor animado, tema Sombra | TokenCode |

## 6. Limitações da análise

- Somente leitura estática. Nenhum módulo do alvo foi executado sob instrumentação.
- `app.asar` está minificado; nomes de funções internas foram inferidos por comportamento e strings.
- O engine `opencode-cli.exe` é um binário Bun compilado; a comparação com o OpenCode upstream foi feita
  por versão declarada (`opencode-cli.version` = 2.3.0), não por diff binário.
- Chaves de API do usuário ficam em `%APPDATA%\TokenCode` e não foram lidas nem copiadas.
