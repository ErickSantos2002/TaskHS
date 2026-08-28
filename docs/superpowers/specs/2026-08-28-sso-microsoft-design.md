# SSO Microsoft (Entra ID) — design

**Data:** 2026-08-28
**Status:** aprovado no brainstorming, aguardando revisão do Erick

## Problema

Entrar no TaskHS hoje exige e-mail e senha próprios do sistema. São 26 pessoas,
**todas com conta `@healthsafetytech.com`** no Entra ID da empresa — ou seja,
todo mundo já tem uma identidade corporativa e mantém uma senha a mais só por
causa do TaskHS. Senha a mais é senha esquecida, senha repetida e senha
redefinida na mão pelo administrador.

O HSGrowth CRM já resolveu isso: tem "Entrar com Microsoft" desde a Fase 1 da
integração Microsoft 365 (ver `MICROSOFT365_INTEGRACAO.md` no repo do CRM). Este
documento leva o mesmo recurso para o TaskHS, com dois desvios conscientes do
que o CRM fez — explicados em "Decisões".

## Escopo

**Dentro:**

- Botão "Entrar com Microsoft" na tela de login.
- Endpoints de autorização, callback e troca de ticket no backend.
- Página `/auth/callback` no frontend.
- Envs novas, entrada no changelog.

**Fora (de propósito):**

- **Provisionamento automático.** Quem não tem usuário no TaskHS não entra —
  volta para o `/login` com mensagem. O cadastro continua sendo feito na tela de
  Usuários. Isso mantém o controle de acesso num lugar só e evita o tenant
  inteiro (não só as 26 pessoas) ganhando conta ao logar.
- **Qualquer uso do Graph além do login.** Escopo `User.Read`, apenas para ler
  nome e e-mail. O token da Microsoft é usado no callback e descartado; nenhuma
  coluna `ms_access_token`/`ms_refresh_token` no `User`. O CRM guarda esses
  tokens porque manda e-mail e lê calendário pelo card — o TaskHS não faz nada
  disso, e guardar credencial que ninguém usa é só superfície de ataque.
- **Desligar o login por senha.** Os dois convivem. Se um dia o SSO for o único
  caminho, é decisão separada.
- **Refresh token.** O TaskHS não tem — o JWT de 8h vale igual para os dois
  caminhos de login.

## Fluxo

```
LoginPage → GET /api/auth/microsoft            302 → login.microsoftonline.com
Microsoft → GET /api/auth/microsoft/callback?code=...
            troca code por token → GET /me no Graph → e-mail
            busca User por e-mail:
              não achou  → 302 {FRONTEND_URL}/login?erro=usuario_nao_encontrado
              inativo    → 302 {FRONTEND_URL}/login?erro=usuario_inativo
              ok         → JWT normal (8h) + AuditLog action="login"
                         → 302 {FRONTEND_URL}/auth/callback?ticket=<opaco>
Front /auth/callback → POST /api/auth/sso/exchange {ticket}
                     → {access_token, user}  (mesmo TokenOut do login por senha)
                     → AuthContext persiste → "/"
```

A partir do `sso/exchange` não há nada de especial: o token é o mesmo que o
`POST /auth/login` devolve, e daí para frente a sessão é indistinguível.

## Decisões

### O JWT não passa pela URL

O CRM redireciona para `/auth/callback?access_token=...&refresh_token=...`. Um
JWT de 8 horas na query string entra no histórico do navegador, no `Referer` da
próxima requisição e em qualquer log de proxy no caminho.

Aqui o callback guarda o JWT sob um **ticket opaco de uso único** e manda só o
ticket na URL. O front troca o ticket pelo token num `POST`. Ticket já usado, ou
com mais de 60 s, devolve 401.

Isso não é invenção: o TaskHS já usa exatamente essa ideia no SSE
(`POST /api/boards/{id}/stream-ticket`, ticket de ~60 s), porque `EventSource`
também não aceita header de autorização. A diferença é que o ticket do SSE é um
JWT assinado com `scope: "stream"` e o do SSO é opaco e guardado em memória —
JWT assinado é reproduzível dentro da validade, e para trocar por uma sessão de
8 h queremos uso **realmente** único.

### Ticket em memória

`app/core/sso_tickets.py`: um `dict` de `token → (jwt, expira_em)`, chave
`secrets.token_urlsafe(32)`, TTL 60 s, `pop` na troca, varredura preguiçosa dos
vencidos a cada emissão. Sem tabela, sem Redis.

Isso **assume processo único**, que já é premissa do projeto em dois outros
lugares (o hub SSE em memória e o loop de lembretes; ver `CLAUDE.md`). Se um dia
o backend rodar com múltiplos workers, esses três caem juntos e a correção é a
mesma: estado compartilhado. Reiniciar o backend descarta tickets pendentes —
consequência: quem estava exatamente no meio do redirect clica de novo.

### E-mail é a chave

A busca é `User.email == email`, com o e-mail da Microsoft normalizado
(`mail` ou, se vier nulo, `userPrincipalName`; `.lower().strip()`).

Conferido em 2026-08-28: as **26 contas ativas do TaskHS são todas
`@healthsafetytech.com`**, sem exceção. Então não há usuário que fique de fora
por divergência de domínio. Usuário criado no futuro com e-mail de outro domínio
simplesmente não terá SSO — entra pela senha.

### SSO desligável

As cinco envs nascem com default `""` no `config.py`. Com `MS_CLIENT_ID` vazio o
`GET /auth/microsoft` responde 503 e o front esconde o botão. Assim quem sobe o
projeto local sem app no Azure não vê nada quebrado, e o `.env.example` pode ir
para o repo público com os campos em branco.

## Backend

| Arquivo | Ação |
|---|---|
| `requirements.txt` | `+ msal`, `+ httpx` (pinados) |
| `app/core/config.py` | `+ MS_CLIENT_ID`, `MS_TENANT_ID`, `MS_CLIENT_SECRET`, `MS_REDIRECT_URI`, `FRONTEND_URL` — todos `str = ""`; `+ property sso_enabled` |
| `app/core/sso_tickets.py` | **criar** — `issue(jwt) -> str`, `redeem(ticket) -> str \| None` |
| `app/services/microsoft_auth.py` | **criar** — `get_authorization_url()`, `exchange_code_for_token(code)`, `get_user_profile(access_token)` |
| `app/routers/auth.py` | `+ GET /microsoft`, `+ GET /microsoft/callback`, `+ POST /sso/exchange` |
| `backend/.env.example` | `+` as cinco vars, **vazias** |

`microsoft_auth.py` espelha o `microsoft_auth_service.py` do CRM, com duas
diferenças: `SCOPES = ["User.Read"]` (o CRM pede cinco escopos) e o `GET /me` sai
por `httpx.AsyncClient`, porque aqui tudo é async.

Os três endpoints são **públicos** — não podem depender de `get_current_user`,
já que o objetivo deles é justamente criar a sessão.

### Auditoria

O callback bem-sucedido grava `AuditLog` com `action="login"` — a mesma ação do
login por senha —, mudando só o `summary` para `"Fulano" entrou no sistema via
Microsoft`. Ação nova (`login_sso`) não entraria na lista `ACTIONS` da
`LogsPage.tsx` e ficaria invisível no filtro. Falha de SSO com usuário
identificável grava `login_falhou`, como já acontece hoje.

## Frontend

| Arquivo | Ação |
|---|---|
| `src/pages/AuthCallbackPage.tsx` | **criar** — troca o ticket; em erro, mensagem + "Voltar para o login" |
| `src/App.tsx` | `+` rota pública `/auth/callback`, ao lado de `/login` |
| `src/contexts/AuthContext.tsx` | `+ loginWithToken(token, user)` — reusa a persistência do login normal |
| `src/pages/LoginPage.tsx` | divisor "ou" + botão com o logo Microsoft; lê `?erro=` e mostra a mensagem |
| `src/data/changelog.ts` | entrada nova no topo — novidade → **v1.14.0** |

O botão é uma âncora com `href` montado a partir do `API_BASE`, não um `fetch`: o fluxo é
uma navegação de página inteira até a Microsoft, e XHR não redireciona
cross-origin.

`loginWithToken` existe para o `AuthCallbackPage` não duplicar a escrita de
`taskhs-token`/`taskhs-user` no localStorage — a persistência fica num lugar só,
como já é hoje.

Mensagens de erro:

| `?erro=` | Texto |
|---|---|
| `usuario_nao_encontrado` | Nenhuma conta TaskHS para este e-mail Microsoft. Fale com o administrador. |
| `usuario_inativo` | Sua conta está inativa. Fale com o administrador. |
| `falha_microsoft` | Falha na autenticação com a Microsoft. Tente novamente. |

## Azure e deploy

App Registration **TaskHS**, single tenant (`healthsafetytech.com`), permissão
delegada `User.Read` com admin consent. Criado em 2026-08-28.

Redirect URIs cadastradas:

- `https://taskhsapi.healthsafetytech.com/api/auth/microsoft/callback` (produção)
- `http://localhost:8000/api/auth/microsoft/callback` (dev)

Envs de produção (Easypanel, serviço backend):

```
MS_CLIENT_ID=…
MS_TENANT_ID=…
MS_CLIENT_SECRET=…
MS_REDIRECT_URI=https://taskhsapi.healthsafetytech.com/api/auth/microsoft/callback
FRONTEND_URL=https://taskhs.healthsafetytech.com
```

O `backend/.env` local já está preenchido apontando para **produção**. Para
testar o fluxo na máquina, trocar `MS_REDIRECT_URI` para a variante `localhost`
(já cadastrada no Azure) e `FRONTEND_URL` para `http://localhost:5173`.

O client secret vive só no `.env` (gitignorado) e no Easypanel — **nunca** em
arquivo versionado, incluindo este documento. O secret expira em 24 meses; a
renovação é gerar outro no portal e atualizar as duas pontas.

## Verificação

Não há suíte de testes no projeto; a verificação é manual.

1. Backend sobe e `/docs` lista `GET /api/auth/microsoft`,
   `GET /api/auth/microsoft/callback` e `POST /api/auth/sso/exchange`.
2. Com as envs vazias: botão some do login, `GET /auth/microsoft` devolve 503.
3. Fluxo feliz no navegador: clicar no botão → autenticar com a conta
   corporativa → voltar logado, com o nome certo na sidebar.
4. Conta Microsoft sem usuário no TaskHS → `/login` com a mensagem de
   "nenhuma conta TaskHS".
5. Usuário desativado na tela de Usuários → mensagem de conta inativa.
6. Repetir o `POST /sso/exchange` com o mesmo ticket → 401.
7. `npm run build` passa.
8. Login por e-mail e senha continua funcionando.
9. Tela de Logs mostra o acesso como `login`, com "via Microsoft" no resumo.

## Notas relacionadas

- `MICROSOFT365_INTEGRACAO.md` (repo hsgrowth-sistema) — a implementação que
  serviu de referência.
- [Autorização por membresia](2026-07-16-acesso-quadros-design.md) — o SSO não
  toca nela: o que muda é como a sessão nasce, não o que ela pode ver.
