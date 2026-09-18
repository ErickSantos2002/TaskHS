# Imagem em comentário de card — design

**Data:** 2026-09-18
**Status:** aprovado no brainstorming, aguardando revisão do Erick

## Problema

Comentário de card é texto puro. Quando alguém precisa mostrar alguma coisa — o
print do erro, a foto do equipamento, o recorte da tela do ERP — tem dois
caminhos, e os dois são ruins:

1. Salvar o print em arquivo, subir pelo bloco **Anexos** e escrever um
   comentário explicando a qual arquivo se refere. O anexo fica solto no card,
   longe do texto que o explica, e daqui a um mês ninguém sabe qual `image.png`
   era qual.
2. Mandar por WhatsApp. É o que acontece na prática, e aí a informação sai do
   card — que é exatamente o que o TaskHS existe para evitar.

O atrito principal é o print: `Print Screen` e o recorte de tela do KDE colocam
a imagem no **clipboard**, não em arquivo. Hoje não existe lugar nenhum no
TaskHS onde `Ctrl+V` resolva — é obrigatório salvar em disco antes.

## Escopo

**Dentro:**

- Anexar **imagem** (JPG, PNG, GIF, WEBP) ao escrever um comentário, por três
  caminhos: colar (`Ctrl+V`), arrastar sobre a caixa e botão de clipe.
- A imagem enviada no comentário **é** um anexo do card: aparece no bloco
  **Anexos** junto com os demais, sem tratamento à parte.
- Exibição da imagem como miniatura dentro do comentário, abrindo no lightbox
  que já existe.
- Comentário só com imagem, sem texto.
- Coluna `comment_id` em `card_attachments` + migration `011`.
- Entrada no changelog (v2.3.0).

**Fora (de propósito):**

- **Arquivo que não é imagem no comentário.** PDF, XML, DOC e planilha continuam
  pelo bloco Anexos. Decisão do Erick no brainstorming: a caixa de comentário
  fica com cara de conversa, não de gaveta de arquivo.
- **Mexer nas imagens ao editar o comentário.** A edição continua só de texto
  (ver "Decisões").
- **Imagem no meio do texto.** As miniaturas ficam abaixo do corpo do
  comentário, sempre. Posicionar imagem dentro do texto exigiria marcação no
  corpo — descartado em "Alternativas".
- **Redimensionar ou comprimir a imagem no servidor.** Vale o limite de 10 MB
  que os anexos já têm.
- **Colar imagem na descrição do card.** Só no comentário.

## Fluxo

Do ponto de vista de quem usa:

1. A pessoa está com o card aberto, na aba **Comentários**. Dá `Ctrl+V` com um
   print no clipboard (ou arrasta o arquivo sobre a caixa, ou clica no clipe).
2. A imagem aparece como miniatura de **pré-visualização** abaixo da caixa, com
   um X para tirar. **Nada subiu para o servidor ainda.**
3. Ela escreve o texto (ou não) e clica em **Enviar**.
4. As imagens sobem pelo endpoint de anexos que já existe; com os ids em mãos, o
   comentário é criado carregando esses ids.
5. O comentário aparece no histórico com as miniaturas embaixo do texto, e as
   mesmas imagens aparecem no bloco **Anexos** do card.
6. Quem estiver com o card aberto em outra máquina vê tudo chegar pelo SSE.

## Modelo de dados

`card_attachments` ganha uma coluna:

```sql
comment_id INTEGER NULL REFERENCES card_comments(id) ON DELETE SET NULL
```

- `comment_id` nulo → anexo solto, o de hoje, subido pelo bloco Anexos.
- `comment_id` preenchido → imagem que veio naquele comentário. **Continua sendo
  anexo do card do mesmo jeito** (`card_id` preenchido como sempre), então o
  bloco Anexos não precisa de nenhuma mudança para exibi-la.

Mais um índice em `comment_id`, para o agrupamento na serialização.

**O `ON DELETE SET NULL` não é enfeite.** `Card.comments` e `Card.attachments`
têm `cascade="all, delete-orphan"` no ORM: ao excluir um card, o SQLAlchemy
apaga os filhos coleção por coleção, e **não há ordem garantida entre as duas
coleções**. Se os comentários forem apagados antes dos anexos, a FK estoura e
`delete_card` devolve 500. Com `SET NULL` não existe ordem errada possível. Essa
é a mesma família de armadilha já documentada no `CLAUDE.md` para `Notification`
e `Reminder`, que não têm cascade e por isso são apagados à mão.

**Nenhum relationship novo no ORM.** A ligação comentário→anexos é resolvida
agrupando em memória (ver "Serialização"). Declarar um `CardComment.attachments`
criaria um segundo caminho de cascade sobre uma coleção que hoje funciona, sem
ganhar nada.

## Migration

`backend/migrations/011_comment_attachments.sql`, aditiva e idempotente:

```sql
ALTER TABLE card_attachments
  ADD COLUMN IF NOT EXISTS comment_id INTEGER REFERENCES card_comments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_card_attachments_comment_id
  ON card_attachments (comment_id);
```

Aplicada sozinha no boot pelo runner (`app/migrations.py`), depois do
`create_all`. Não precisa rodar nada à mão no deploy.

## Backend

### O endpoint de upload não muda

As imagens sobem pelo `POST /api/lists/{list_id}/cards/{card_id}/attachments`
que já existe, herdando validação de tipo, limite de 10 MB, gravação em disco
com nome UUID, registro de atividade e SSE. O vínculo com o comentário acontece
depois, na criação dele.

### `POST .../cards/{card_id}/comments`

`CommentCreate` ganha:

```python
attachment_ids: list[int] = []   # máx. 5
```

e `body` passa de `min_length=1` para `min_length=0`, com uma regra de
validação nova: **texto vazio só é aceito se houver `attachment_ids`**. Um
comentário sem texto e sem imagem continua sendo 422.

Antes de criar o comentário, o endpoint valida os ids **numa consulta só**,
exigindo de cada um:

- pertencer a **este** card (`card_id` bate);
- ser imagem (`content_type` começa com `image/`);
- ainda não ter dono (`comment_id IS NULL`).

Se a quantidade encontrada não bater com a quantidade pedida, devolve **400** e
não cria nada — melhor recusar o comentário inteiro do que criar um comentário
com metade das imagens. Passando, carimba o `comment_id` nas linhas.

Ids repetidos no pedido são deduplicados antes da contagem, senão `[7, 7]`
acharia 1 de 2 e daria 400 por um erro do cliente que não é erro de verdade.

### Notificação do sino

O trecho da notificação hoje é o começo do texto do comentário. Com texto
vazio, a mensagem sairia `Fulano comentou em "X": ` — com dois pontos e nada
depois. Quando não há texto, a mensagem passa a ser:

```
Fulano enviou uma imagem em "Título do card"
```

Vale para as duas notificações que o endpoint dispara (menção e comentário).
Menção em comentário sem texto é possível — o corpo pode ser só `@[Nome](3)` —
e nesse caso o trecho não é vazio, então a regra não se aplica.

### Serialização

`_comment_to_dict(c, anexos)` ganha o parâmetro (`[]` por padrão) e devolve a
chave `attachments`, no **mesmo formato do anexo do card** (`attachment_to_dict`
/ `AttachmentOut`, com `is_image`), para o front não precisar de um segundo
tipo.

- `_card_to_dict` agrupa os anexos já carregados por `comment_id` em memória —
  o card já traz comentários e anexos pelo `selectinload` do `_card_options()`,
  então **nenhuma consulta nova**.
- `add_comment`, `edit_comment` e `delete_comment` devolvem um comentário só;
  esses buscam os anexos do comentário com um `select` curto.

**Comentário excluído devolve `attachments: []`**, junto com o corpo vazio que
já devolve hoje. O arquivo continua existindo e aparecendo no bloco Anexos — o
que some é a exibição dentro do comentário apagado.

`CommentOut` ganha `attachments: list[AttachmentOut] = []`.

### O que não muda

`DELETE .../attachments/{id}` continua igual: apaga a linha e o arquivo do
disco, com a mesma regra de autor-ou-admin. A imagem some do comentário como
efeito da linha ter sumido, sem código novo.

## Frontend

### Caixa de comentário

Os três caminhos caem na mesma função de seleção:

- **`onPaste`** na textarea, lendo imagem de `clipboardData`.
- **`onDrop`** sobre a caixa. **Precisa de `stopPropagation`:** o modal do card
  já captura arquivos arrastados para mandar direto ao bloco Anexos, e sem isso
  a imagem sairia do comentário e apareceria só lá embaixo.
- **Botão de clipe** ao lado do "Enviar", com input escondido
  `accept="image/jpeg,image/png,image/gif,image/webp"`.

Imagem colada chega sem nome de arquivo utilizável (os navegadores mandam
`image.png` para todo mundo). Ela recebe um nome derivado do instante —
`colado-2026-09-18-1530.png` — senão o bloco Anexos vira uma pilha de
`image.png` indistinguíveis.

### Pré-visualização antes de enviar

As imagens escolhidas viram miniaturas locais (objectURL) abaixo da caixa, cada
uma com um X. **Nada sobe antes do clique em "Enviar"** — quem colou o print
errado e desistiu não deixa anexo órfão no card. Os objectURLs são revogados ao
remover a miniatura e ao enviar, para não vazar memória no modal, que fica
aberto bastante tempo.

O botão "Enviar", que hoje só aparece quando há texto, passa a aparecer também
quando há imagem em espera.

### Envio

1. `api.upload(...)` com as imagens → devolve os anexos criados.
2. `api.post(.../comments, { body, attachment_ids })`.
3. O estado local recebe **as duas coisas**: o comentário novo na lista e os
   anexos novos em `attachments`, e chama `onCardUpdate` para o quadro atrás do
   modal acompanhar.

Falha no passo 1 → recado na linha de erro do comentário, as miniaturas
continuam lá, nada foi criado. Falha no passo 2 → as imagens já estão no card
(aparecem em Anexos) e o recado diz isso, para a pessoa não mandar tudo de novo
e duplicar. É uma falha benigna: o arquivo está salvo, que é o objetivo.

### Exibição no histórico

Miniaturas abaixo do corpo do comentário, em grade; clique abre o **lightbox que
já existe**. Não há requisição nova: o modal já baixa as miniaturas de todos os
anexos do card por blob autenticado (`thumbs`, por id do anexo), e a imagem do
comentário é um anexo do card — então já vem baixada.

### Casos de borda na tela

| Situação | O que aparece |
|---|---|
| Comentário excluído | Só o "Comentário excluído" de sempre; nenhuma imagem |
| Imagem apagada em Anexos, comentário era só a imagem | *"imagem removida"*, em itálico |
| Imagem apagada em Anexos, comentário tinha texto | O texto, sem lápide no lugar da imagem |
| Comentário em edição | Miniaturas visíveis, fixas — a edição é só do texto |
| Mais de 5 imagens, tipo errado ou acima de 10 MB | Recado na linha de erro do comentário, **antes** de subir |

A segunda e a terceira linha são a mesma regra vista de dois ângulos: o
comentário renderiza o que tem. Sem texto e sem imagem, mostra "imagem
removida"; com texto, mostra o texto. **Não existe lápide por imagem** — um
comentário com duas imagens que perdeu uma mostra a que sobrou, e pronto.
Registrar imagem morta exigiria guardar o que foi apagado, e isso é memória de
exclusão que o sistema não tem em lugar nenhum.

## Decisões

**Por que só imagem.** Decisão do Erick. O custo é uma segunda regra de tipo no
sistema (o comentário aceita menos que o bloco Anexos), e o ganho é a caixa de
comentário continuar tendo cara de conversa. Quem precisa mandar a NF-e tem o
bloco Anexos a dois centímetros dali.

**Por que o anexo e o comentário são independentes na exclusão.** O comentário
usa exclusão *soft* — a linha fica, o corpo some. Se o arquivo fosse junto, o
botão Excluir do comentário viraria a única exclusão irreversível do card,
apagando do disco uma foto que pode ser a única evidência do problema. Na outra
direção, apagar um anexo passaria a apagar conversa sem avisar.

**Por que a edição não mexe nas imagens.** A edição guarda o texto original — o
"(editado)" abre a 1ª versão. Se a imagem entrasse na edição, esse histórico
passaria a mentir: mostraria o texto antigo com a foto nova. Quem errou o print
exclui o comentário e manda outro.

**Por que subir só no "Enviar".** Subir na hora de colar daria feedback mais
rápido e um caminho de erro mais simples, mas encheria o card de anexos órfãos
de gente que colou e desistiu — e "colar e desistir" é comum justamente porque
colar é barato.

**Por que o vínculo fica no anexo e não no comentário.** Uma coluna
`comment_id` no anexo cobre 1 comentário → N imagens sem tabela de ligação. O
inverso (lista de ids no comentário) exigiria coluna array ou tabela nova.

## Alternativas descartadas

**Endpoint de comentário em multipart.** `POST /comments` aceitaria
`multipart/form-data` com texto e arquivos, criando tudo numa transação — sem
anexo órfão possível e numa requisição só. Descartado porque reescreve o
contrato de um endpoint que hoje é JSON e já carrega menções, validação contra
`board_members` e disparo de notificações; e porque duplicaria (ou obrigaria a
extrair) toda a lógica de upload de `attachments.py`. Muita superfície mexida
pelo mesmo resultado visível.

**Marcador no corpo do comentário** (`![](anexo:12)`). Não precisaria de
migration e deixaria a imagem no meio do texto. Descartado porque o corpo do
comentário viraria uma mini-linguagem para interpretar e higienizar, editar o
texto poderia quebrar a referência, e o histórico "(editado)" mostraria o
marcador cru.

## Segurança

- O router de anexos e o de cards já nascem trancados por membresia
  (`require_board_access_by_list_id`), então nenhum endpoint novo precisa
  repetir a checagem — e nenhum endpoint novo é criado, só campos.
- A validação de `attachment_ids` **exige `card_id` igual ao card da URL**. Sem
  isso, alguém passaria o id de um anexo de outro quadro e o exibiria no seu
  comentário — leitura de arquivo alheio pela porta dos fundos. É a mesma
  armadilha do "destino no corpo" já documentada no `CLAUDE.md` para
  `update_card`/`copy_card`.
- O download continua sendo pelo endpoint autenticado; a imagem do comentário
  não vira arquivo estático público.

## Verificação

O projeto não tem suíte de testes — a verificação é manual, conforme o
`CLAUDE.md`.

**Automático:**

- `cd frontend && npm run build` (roda `tsc -b`) e `npm run lint`.
- Backend sobe pelo `docker compose up -d --build`; `curl /api/health`.
- Log do boot mostrando a `011` aplicada.

**No navegador, com dois usuários no mesmo quadro:**

1. Colar print com `Ctrl+V` na caixa → miniatura de pré-visualização aparece.
2. Arrastar arquivo de imagem sobre a caixa → vai para o comentário, **não**
   para o bloco Anexos.
3. Escolher pelo botão de clipe.
4. Tirar uma imagem da pré-visualização pelo X.
5. Enviar comentário **só com imagem**, sem texto.
6. Confirmar que a imagem aparece no comentário **e** no bloco Anexos.
7. Confirmar que o outro usuário recebe comentário e anexo pelo SSE, sem F5.
8. Conferir a notificação do sino do comentário sem texto ("enviou uma imagem").
9. Excluir, pelo bloco Anexos, a imagem do comentário sem texto do passo 5 →
    aquele comentário passa a mostrar "imagem removida".
10. Excluir o comentário → imagem continua em Anexos.
11. Tentar 6 imagens → recado, e nada sobe.
12. **Excluir um card que tenha comentário com imagem → sem 500** (é o caso que
    o `ON DELETE SET NULL` protege).
13. Excluir o quadro inteiro nas mesmas condições.

## Changelog

Fecha com entrada nova no topo de `frontend/src/data/changelog.ts`:
**v2.3.0**, `kind: "novidade"`.
