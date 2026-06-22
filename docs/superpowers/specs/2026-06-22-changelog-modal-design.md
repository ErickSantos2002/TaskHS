# Changelog Modal — Design

**Data:** 2026-06-22
**Status:** Aprovado
**Contexto:** TaskHS (clone de Trello da Health & Safety). Espelhar o recurso "Ver novidades" do outro sistema da empresa (GestorHS): o nome+versão no rodapé da sidebar vira um botão que abre uma modal de changelog mostrando as últimas versões e o que mudou em cada uma. Serve também para **lançar oficialmente o sistema na v1.0.0**. Hoje o rodapé da sidebar ([frontend/src/layouts/MainLayout.tsx:226-234](frontend/src/layouts/MainLayout.tsx)) mostra `TaskHS` + badge `v0.1.0` (estático), e o [LoginPage.tsx:128](frontend/src/pages/LoginPage.tsx) mostra `TaskHS · Health & Safety Tech · v0.1.0`.

## Decisões (definidas com o Erick)

| Tema | Decisão |
|------|---------|
| Armazenamento do changelog | **Constante no frontend** (`src/data/changelog.ts`). É conteúdo autoral do desenvolvedor; sem backend/tabela/API. |
| Gatilho | O rodapé `TaskHS · vX.Y.Z` da sidebar vira **botão** com tooltip "Ver novidades" → abre `ChangelogModal`. |
| Versão exibida | Derivada de `CHANGELOG[0].version` (fonte única). Rodapé da sidebar **e** o LoginPage passam a ler dela. |
| Seed inicial | **v1.0.0** (lançamento oficial), marcada "Versão atual", resumindo o que o sistema entrega. |
| Convenção de processo | Registrar no `CLAUDE.md` que **nenhuma mudança pode ser concluída sem adicionar uma entrada de versão** no changelog. |
| Testes | Sem suíte automatizada (padrão do projeto). Verificação por `npm run build` + navegador. |

## 1. Fonte de dados — `frontend/src/data/changelog.ts`

```ts
export type ChangeKind = "novidade" | "melhoria" | "correcao";

export interface ChangelogChange {
  kind: ChangeKind;
  text: string;
}

export interface ChangelogVersion {
  version: string;      // ex.: "1.0.0"
  date: string;         // ISO "YYYY-MM-DD"
  changes: ChangelogChange[];
}

export const CHANGELOG: ChangelogVersion[] = [ /* mais recente primeiro */ ];

export const APP_VERSION = CHANGELOG[0].version;
```

**Ordem:** o array é mantido com a versão mais recente em `CHANGELOG[0]`. `APP_VERSION` deriva daí. A "versão atual" é sempre o primeiro item (não há flag `current` manual — evita inconsistência).

**Seed (v1.0.0, data = 2026-06-22):**
- `novidade`: "Lançamento oficial do TaskHS — substituto do Trello na Health & Safety."
- `novidade`: "Quadros, listas e cartões com arrastar e soltar."
- `novidade`: "Etiquetas, membros, comentários e checklists nos cartões."
- `novidade`: "Anexos (arquivos e imagens) nos cartões."
- `novidade`: "Lembretes automáticos por data de entrega e lembretes pessoais."
- `novidade`: "Automações por evento (ex.: ao mover um cartão para uma lista, marcar a data como concluída)."
- `novidade`: "Notificações no sino, importação de quadros do Trello e administração de usuários."

## 2. Componente — `frontend/src/components/ChangelogModal.tsx`

Props: `{ onClose: () => void }`. Lê `CHANGELOG` diretamente.

Layout (espelha o visual do GestorHS, usando as classes Tailwind/tema já existentes no projeto — `bg-background-elevated`, `border-border`, `text-slate-*`, `primary`):
- **Cabeçalho:** título "O que há de novo?" + subtítulo "Atualizações recentes do TaskHS" + botão `×` (canto superior direito).
- **Corpo (scrollável, `max-h`):** para cada versão em `CHANGELOG`:
  - linha com **tag de versão** `v{version}` (pill verde/`primary`), a **data** formatada `dd/mm/yyyy` (pt-BR), e, **só no primeiro item**, o selo **"Versão atual"** (pill).
  - cartão com a lista de `changes`: cada um com um **badge** colorido por `kind` e o texto:
    - `novidade` → "Novidade"
    - `melhoria` → "Melhoria"
    - `correcao` → "Correção"
- **Rodapé:** "TaskHS — desenvolvido internamente pela Health & Safety".
- **Fechar:** clique no `×`, clique no backdrop (fora do cartão) e tecla **Esc**.

Componente isolado, sem estado além do que o pai controla (visível/oculto). Sem chamadas de API.

## 3. Integração

**`frontend/src/layouts/MainLayout.tsx`** (rodapé da sidebar, ~linha 226-234):
- Transformar o bloco do rodapé em um `<button>` clicável (tooltip/`title` "Ver novidades") que faz `setShowChangelog(true)`.
- Trocar o texto fixo `v0.1.0` por `v{APP_VERSION}` (import de `changelog.ts`).
- Estado local `const [showChangelog, setShowChangelog] = useState(false)` e render condicional `{showChangelog && <ChangelogModal onClose={() => setShowChangelog(false)} />}`.
- Quando a sidebar está colapsada o rodapé fica oculto (comportamento atual mantido); o acesso à modal é pela sidebar expandida.

**`frontend/src/pages/LoginPage.tsx`** (~linha 128):
- Trocar o `v0.1.0` fixo por `v{APP_VERSION}` (mesma fonte). Não vira botão (tela de login).

## 4. CLAUDE.md — convenção de versionamento

Adicionar uma seção curta e explícita (em "Gotchas" ou seção própria "Changelog / versionamento"):
> **Toda mudança no sistema deve terminar com uma entrada nova no changelog** (`frontend/src/data/changelog.ts`): adicionar um `ChangelogVersion` no topo do array (mais recente primeiro), com `version`, `date` e os `changes`. Versionamento semântico: correção → patch (1.0.x), melhoria → minor (1.x.0), novidade grande → minor/major. `APP_VERSION` (rodapé da sidebar + LoginPage) deriva automaticamente de `CHANGELOG[0]`, então basta editar o array. Não concluir uma feature/fix sem essa entrada.

## 5. Fora de escopo (v1)

- Backend/tabela/API de changelog; edição de changelog pela UI.
- Marcar "lido/não lido" ou badge de "novidades não vistas" no botão.
- i18n (tudo em pt-BR, como o resto do app).
- Markdown/links ricos dentro das entradas (texto simples por mudança).

## 6. Critérios de aceite

1. O rodapé da sidebar mostra `TaskHS` + `v1.0.0` e é clicável; clicar abre a modal.
2. A modal lista a v1.0.0 com selo "Versão atual", data 22/06/2026 e os itens de mudança com badges por tipo.
3. Fechar funciona por ×, clique fora e Esc.
4. O `v0.1.0` antigo não aparece mais em lugar nenhum (sidebar e login leem `APP_VERSION` = "1.0.0").
5. `npm run build` passa (tsc estrito + verbatimModuleSyntax — usar `import type` para os tipos).
6. Adicionar uma versão nova é só prepend de um objeto no array, sem mexer em mais nada para a versão exibida atualizar.
