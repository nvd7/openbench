# TokenCode — modelo de segurança observado

Somente leitura estática. Não é auditoria de segurança contratada; é o que o código empacotado mostra.

## 1. Gate de acesso (Discord)

- OAuth2 authorization code com PKCE provavelmente (redirect fixo em loopback `http://127.0.0.1:39473/discord/callback`).
- Escopos declarados: básico — `identify` e lista de guilds.
- Presença no guild `1560730077216636928` ("TokenBypass") é o critério de liberação.
- A verificação fica em cache local e é protegida por DPAPI do Windows (`%APPDATA%\TokenCode\discord`).
- Não há chamada a backend próprio para validar licença: o gate é **client-side**. Um fork pode remover
  a checagem; o binário não depende de servidor de licença.

Limite: o gate autentica a conta Discord, não o pagamento. Não há entitlement além de "está no servidor".

## 2. Atualizações

- Release channel: `BlackLiztZ/TOKENCODE-releases`.
- Instalador validado por **Ed25519** (`distribution.json.publicKey`) sobre o digest SHA-256.
- `electron-updater` está nas dependências do app base, mas a tela `toolkit/updates.js` faz o fluxo
  próprio (consulta release → baixa → verifica → executa).
- Risco estrutural: a chave privada do repositório de releases é o único ponto de confiança. Sem
  transparência (sem Certificate Transparency, sem reproducible build), um comprometimento dessa chave
  distribui código arbitrário para todos os usuários.

## 3. Isolamento do renderer

- `contextIsolation`, `nodeIntegration: false`, preload restrito — herdado do OpenCode Desktop.
- O toolkit adiciona um canal RPC próprio via `MessageChannel`, entregue apenas quando `isAllowed(url)`
  retorna verdadeiro, reemitido a cada navegação e limpo em `closed`.
- O renderer não fala HTTP direto com a engine: as chamadas passam pelo main.

Ponto de atenção: o toolkit expande a superfície do preload original. Qualquer `isAllowed` frouxo
(por exemplo, permitir `file://` fora do app) transforma o RPC em execução de git clone arbitrário.
O `service.mjs` sanitiza o id do repositório com regex antes de montar o path — mitiga traversal.

## 4. Rede e privacidade

| Componente | Efeito |
|---|---|
| `infinite.mjs` | Rotação de saída via WARP (`127.0.0.1:40000`), Tor (`19050` SOCKS, `19051` control, `18118` HTTP) e proxies. Muda o IP de saída do engine. |
| `socks-bridge.mjs` | Bridge local SOCKS→HTTP. Escuta em loopback. |
| `tor-service.mjs` | Sobe `tor.exe` portátil. Nenhuma config de exit node fixa observada. |
| `tokeninf-service.mjs` | Serviço de metadados de token/limites. |

Implicação: quando a rotação está ligada, o tráfego do modelo sai por Tor/WARP. Isso afeta latência,
bloqueios de provider (rate limit por IP) e rastreabilidade — e significa que o provider vê um IP de saída
diferente do real.

## 5. Dados locais

- Sessões em SQLite (`local\data\opencode.db`).
- Config em `profile\opencode.settings` + `local\context\sessions.json`.
- Backups em `backup.mjs`: snapshot `node:sqlite.backup()`, arquivos fixos (`local/data/opencode.db`,
  `profile/drafts.sqlite`, `local/context/sessions.json`, `local/autojb/*`, `local/capri-chat/chat.json`),
  hash SHA-256 por entrada, gzip, retenção de 5.
- Preferências incluídas no backup passam por filtro: chaves com `password|credential|secret|access.token|refresh.token`
  são descartadas. Não há filtro para API keys armazenadas em `opencode.json` — se elas estiverem nesse
  caminho, entram no backup.
- `diagnostic-export.mjs` exporta relatório sem chaves e sem conversas.

## 6. Auto-JB

- `autojb-config.mjs` injeta `autojb-plugin` no `OPENCODE_CONFIG_CONTENT` de toda sessão e força
  `compaction.auto = false`.
- `autojb-default.txt` tem ~96 KB de instruções padrão aplicadas ao system prompt.
- Editável/desligável pelo usuário em Settings.
- Efeito técnico: o system prompt de cada sessão é maior, e a compactação automática fica desligada —
  sessões longas crescem até o limite do provider sem sumarização automática.

## 7. Providers customizados

- `custom-providers.mjs` grava no `opencode.json` global: `npm`, `options.baseURL`, `options.apiKey`,
  `models`.
- Protocolos mapeados para pacotes oficiais (`@opencode/ai/providers/openai-compatible`, etc.).
- A API key fica em texto claro no JSON de config — comportamento padrão do OpenCode, não invenção do
  TokenCode.
- Sem validação de URL contra SSRF (o engine faz a chamada; o usuário é o dono da chave).

## 8. Superfície ofensiva embarcada

- Catálogo com 200+ repositórios de segurança ofensiva (kernel drivers, evasion, C2, credential tools).
  O app **clona** — não instala, não compila, não executa.
- ~200 skills de pentest/red team carregadas como playbooks.
- Nenhum payload ativo no pacote; nenhum beacon, nenhuma persistência embutida observada.

## 9. Resumo de risco

| Item | Nível | Nota |
|---|---|---|
| Gate client-side | baixo | não protege contra fork; só identifica conta |
| Chave de update única | médio | comprometimento = RCE em toda a base |
| RPC do toolkit | baixo/médio | válido desde que `isAllowed` seja estrito |
| Tor/WARP automático | baixo | comportamento esperado, mas muda reputação de IP |
| API keys em JSON claro | baixo | padrão do OpenCode |
| Backups com preferências | baixo | filtro existe, mas depende da chave estar no formato esperado |
| Catálogo ofensivo | informacional | apenas clona repositórios públicos |
