# Token de agente do HS.OS — design

**Data:** 2026-11-05 · **Origem:** pedido da sessão do HS.OS
(`~/github/HS.OS/docs/superpowers/specs/2026-11-05-bot-sistemas-internos-design.md`,
seção "Para os outros repositórios → TaskHS"). As escolhas em aberto foram
confirmadas pela sessão do HS.OS em nome do Erick.

## Intenção

O HS.OS dá a cada colaborador um bot pessoal que age **como a própria pessoa**.
O TaskHS não precisa saber o que é agente, MCP ou bot. Ele só passa a aceitar
mais um tipo de JWT e aplica as permissões que já existem. O bot pode ler e
fazer o trabalho do dia a dia (comentar, mover, criar card, marcar checklist),
mas **nunca usa poderes de gestão**, mesmo quando a pessoa é admin.

## O token

JWT **EdDSA (Ed25519)** com validade de 5 minutos, assinado pelo HS.OS:
`{iss: "hsos", aud: "taskhs", sub: <e-mail>, act: {sub: <id do bot>}, iat, exp, jti}`.

- A chave pública fica na env `HSOS_AGENTE_CHAVE_PUBLICA` (PEM). Também vale
  com `\n` escapado, que vira quebra de linha real antes do uso. Com a env
  vazia, todo token de agente leva **401** e o resto do sistema funciona como hoje.
- O roteamento olha o payload **não verificado**: com `iss == "hsos"`, o token
  segue o caminho do agente; sem isso, segue o caminho de hoje (HS256 via
  `python-jose`), sem nenhuma alteração.
- O caminho do agente usa **PyJWT** (`jwt.decode`) com `algorithms=["EdDSA"]`,
  `audience="taskhs"`, `issuer="hsos"` e `options={"require": ["exp", "sub", "iss", "aud"]}`.
  Qualquer falha dá **401**.
- O usuário é buscado pelo `sub` (e-mail, **sem** `lower()`, porque o login e o
  SSO de hoje comparam o e-mail exatamente como vem) e precisa estar ativo. Se
  não estiver, **401**.
- `act.sub` passa a ser o "via" do request.

`python-jose` não tem EdDSA. Por isso `PyJWT` e `cryptography` entram
**explícitos** no `requirements.txt`. Hoje já estão no container como
dependências transitivas do `msal` e do jose: PyJWT 2.15.1 e cryptography 45.0.7.

## Onde o agente é recusado (403)

Uma dependência única, `bloquear_token_de_agente(request)`, lê o `Authorization`,
decodifica **sem verificar** e devolve **403** quando `iss == "hsos"`. Não
verificar é seguro: quem forjar o cabeçalho só consegue um 403 para si. Ela
funciona também nas rotas sem login (login, register, SSO).

Ela é aplicada em:
- **auth:** `POST /register`, `POST /login`, `PATCH /me`, `POST/DELETE /me/avatar`,
  `/sso/*`, `/microsoft*`. **`GET /auth/me` continua liberado**, porque o bot
  precisa saber o papel da pessoa;
- **`get_admin_user` e `get_elevated_user`:** passam a chamar o bloqueio. Isso
  cobre de uma vez a gestão de usuários e papéis (inclusive o `PATCH /users/{id}`),
  as listas e etiquetas (estrutura do quadro), os setores, os logs e a lixeira
  de admin. A regra é simples: **nenhum poder de elevado é exercido pelo agente**;
- **automações:** o router inteiro, inclusive o GET;
- **quadros:** `POST /boards`, `POST /boards/import`, `PATCH`/`DELETE /{id}`,
  `archive`/`unarchive`, `done-lists`, `list-setores`, `POST`/`DELETE` de membros.

Continuam liberados: as leituras de quadro, snapshot, stream, cards (CRUD,
mover, copiar), comentários, checklists, anexos, lembretes, busca, dashboard e
notificações. As trancas de membresia de hoje valem para eles.

## Histórico "via bot"

O `Actor` (`audit_context.py`) ganha o campo `via: str | None`. O
`get_current_user` preenche esse campo com `act.sub`. Em `_audit_after_flush`,
quando `via` está presente, o `summary` recebe `" (via <bot>)"` no final. O
`actor_type` fica **`usuario`**, para os rankings do dashboard continuarem
contando a pessoa. Sem migration. O `via` também vai para o log do uvicorn numa
linha `logger.info` quando o token de agente é aceito.

## `GET /api/cards/minhas`

Router novo (`app/routers/minhas.py`, prefixo `/cards`). Não cabe no router
`cards`, porque o prefixo dele exige `{list_id}`.

- Parâmetro `abertas: bool = True`.
- Devolve os cards em que o usuário tem linha em `card_members`, em quadros que
  ele alcança. A regra é a de `user_can_access_list`: elevado alcança todos;
  os demais precisam de `board_members`. Ela vai **na própria query** (um JOIN
  com EXISTS), não lista por lista.
- Sempre só itens vivos: card, lista e quadro com `deleted_at IS NULL`.
- Com `abertas=true`, também ficam de fora: `card.done`, `card.archived`,
  `list.is_done`, `list.archived` e quadro com `archived_at`.
- Ordem: `due_date` com os nulos no fim, depois prioridade
  (critical > high > medium > low), depois `id`. Limite de **500**.
- Resposta (lista de objetos):
  `{id, title, board_id, board_title, list_id, list_title, due_date (YYYY-MM-DD|null), due_date_completed, priority, done}`.

## Testes

O repo não tem suíte. A exceção é `backend/tests/test_token_agente.py` (pytest),
**sem banco**, que testa só a função pura de validação
(`validar_token_de_agente(token, chave_pem) -> (email, bot)`) com um par
Ed25519 descartável gerado no teste. Casos: válido; `aud` errado; vencido;
chave errada; `iss` errado; sem `exp`; chave com `\n` escapado. O `pytest` vai
num `requirements-dev.txt` e não entra na imagem.

A parte com banco é conferida à mão no backend local, **só com leitura**,
porque o dev usa o banco de produção: um token gerado com chave local
descartável leva 200 em `/auth/me`, 200 em `/cards/minhas`, 403 em
`/auth/login` e em `/auth/users` e 401 com `aud` errado. Nenhum POST, PATCH ou
DELETE.

## Fora do escopo

- O `POST /api/auth/register` público (achado à parte, para o Erick decidir).
- O deploy: é manual, e o Erick junta os deploys no fim do dia.
