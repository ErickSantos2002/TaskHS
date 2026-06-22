# Changelog Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o nome+versão do rodapé da sidebar em um botão "Ver novidades" que abre um `ChangelogModal` listando as versões do sistema, lançando oficialmente na v1.0.0.

**Architecture:** Changelog é uma constante no frontend (`src/data/changelog.ts`); `APP_VERSION = CHANGELOG[0].version` é a fonte única da versão exibida. Um componente `ChangelogModal` lê essa constante e renderiza as versões. O rodapé do `MainLayout` vira botão que abre a modal; `LoginPage` passa a ler `APP_VERSION`.

**Tech Stack:** React 19 + TypeScript (strict, `verbatimModuleSyntax`) + Tailwind v4.

## Global Constraints

- **Spec de referência:** `docs/superpowers/specs/2026-06-22-changelog-modal-design.md` — seguir à risca.
- **Sem suíte de testes** (CLAUDE.md: "Não há suíte de testes" / "Não invente comandos de teste"). Verificação = `npm run build` (de `frontend/`) passa + checagem no navegador. NÃO criar vitest.
- **`verbatimModuleSyntax` está ligado:** importar tipos com `import type` (ou qualificador `type` inline). `npm run build` quebra se um tipo for importado como valor.
- **Fonte única de versão:** nada de string de versão cravada — sidebar e LoginPage leem `APP_VERSION` de `src/data/changelog.ts`. O `v0.1.0` antigo deve sumir.
- **Tudo em pt-BR.** Usar as classes de tema já existentes (`bg-background-surface`, `bg-background-elevated`, `border-border`, `text-slate-*`, `primary`).
- **Frontend dev server** roda em `localhost:5173` (Vite/HMR); backend em `8000`. Login p/ navegador: `healthsafetyti@gmail.com` / `admin123`.
- **Commits** terminam com `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Dados do changelog + componente `ChangelogModal`

**Files:**
- Create: `frontend/src/data/changelog.ts`
- Create: `frontend/src/components/ChangelogModal.tsx`

**Interfaces:**
- Produces: `CHANGELOG: ChangelogVersion[]`, `APP_VERSION: string`, tipos `ChangeKind`/`ChangelogChange`/`ChangelogVersion` (de `data/changelog`); componente `ChangelogModal({ onClose }: { onClose: () => void })` (export nomeado, de `components/ChangelogModal`).

- [ ] **Step 1: Criar o arquivo de dados**

`frontend/src/data/changelog.ts`:
```ts
export type ChangeKind = "novidade" | "melhoria" | "correcao";

export interface ChangelogChange {
  kind: ChangeKind;
  text: string;
}

export interface ChangelogVersion {
  version: string; // ex.: "1.0.0"
  date: string;    // ISO "YYYY-MM-DD"
  changes: ChangelogChange[];
}

// Mais recente primeiro. APP_VERSION e o selo "Versão atual" derivam de CHANGELOG[0].
export const CHANGELOG: ChangelogVersion[] = [
  {
    version: "1.0.0",
    date: "2026-06-22",
    changes: [
      { kind: "novidade", text: "Lançamento oficial do TaskHS — substituto do Trello na Health & Safety." },
      { kind: "novidade", text: "Quadros, listas e cartões com arrastar e soltar." },
      { kind: "novidade", text: "Etiquetas, membros, comentários e checklists nos cartões." },
      { kind: "novidade", text: "Anexos (arquivos e imagens) nos cartões." },
      { kind: "novidade", text: "Lembretes automáticos por data de entrega e lembretes pessoais." },
      { kind: "novidade", text: "Automações por evento (ex.: ao mover um cartão para uma lista, marcar a data como concluída)." },
      { kind: "novidade", text: "Notificações no sino, importação de quadros do Trello e administração de usuários." },
    ],
  },
];

export const APP_VERSION = CHANGELOG[0].version;
```

- [ ] **Step 2: Criar o componente `ChangelogModal`**

`frontend/src/components/ChangelogModal.tsx`:
```tsx
import { useEffect } from "react";
import { cn } from "../lib/utils";
import { CHANGELOG, type ChangeKind } from "../data/changelog";

const KIND_LABEL: Record<ChangeKind, string> = {
  novidade: "Novidade",
  melhoria: "Melhoria",
  correcao: "Correção",
};

const KIND_CLASS: Record<ChangeKind, string> = {
  novidade: "bg-primary/15 text-primary",
  melhoria: "bg-sky-500/15 text-sky-400",
  correcao: "bg-amber-500/15 text-amber-400",
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function ChangelogModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-12"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-background-surface shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 className="text-lg font-extrabold text-slate-100">O que há de novo?</h2>
            <p className="text-xs text-slate-500 mt-0.5">Atualizações recentes do TaskHS</p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-background-elevated transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[65vh] overflow-y-auto px-6 py-5 space-y-6">
          {CHANGELOG.map((v, i) => (
            <div key={v.version}>
              <div className="flex items-center gap-2.5 mb-2.5">
                <span className="rounded-md bg-primary/15 text-primary px-2 py-0.5 text-xs font-bold">v{v.version}</span>
                <span className="text-xs text-slate-500">{formatDate(v.date)}</span>
                {i === 0 && (
                  <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold">Versão atual</span>
                )}
              </div>
              <ul className="space-y-2">
                {v.changes.map((c, j) => (
                  <li key={j} className="flex gap-2.5 rounded-lg border border-border bg-background-elevated px-3 py-2.5">
                    <span className={cn("shrink-0 h-fit rounded-md px-1.5 py-0.5 text-[10px] font-semibold", KIND_CLASS[c.kind])}>{KIND_LABEL[c.kind]}</span>
                    <span className="text-sm text-slate-300 leading-snug">{c.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-3 text-center">
          <p className="text-xs text-slate-600">TaskHS — desenvolvido internamente pela Health &amp; Safety</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verificar o build**

Run (de `frontend/`): `npm run build`
Expected: `tsc -b && vite build` PASSA, sem erros TS. (O componente ainda não está montado em lugar nenhum — isso é esperado; a verificação visual vem na Task 2.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/data/changelog.ts frontend/src/components/ChangelogModal.tsx
git commit -m "feat(changelog): dados do changelog + ChangelogModal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Integração — botão na sidebar + versão no login

**Files:**
- Modify: `frontend/src/layouts/MainLayout.tsx` (import, estado, rodapé → botão, render da modal)
- Modify: `frontend/src/pages/LoginPage.tsx:128` (versão dinâmica)

**Interfaces:**
- Consumes: `APP_VERSION` (de `../data/changelog`), `ChangelogModal` (de `../components/ChangelogModal`).

- [ ] **Step 1: Imports no MainLayout**

Em `frontend/src/layouts/MainLayout.tsx`, adicionar (junto aos imports do topo, após a linha `import logo from "../assets/logo.png";`):
```tsx
import { APP_VERSION } from "../data/changelog";
import { ChangelogModal } from "../components/ChangelogModal";
```

- [ ] **Step 2: Estado da modal**

Em `MainLayout`, logo após a linha `const [showNotifications, setShowNotifications] = useState(false);` (~linha 98), adicionar:
```tsx
  const [showChangelog, setShowChangelog] = useState(false);
```

- [ ] **Step 3: Transformar o rodapé em botão**

Em `MainLayout`, substituir o bloco do rodapé (atual):
```tsx
        {/* Footer */}
        {!collapsed && (
          <div className="shrink-0 border-t border-border px-5 py-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-600">TaskHS</p>
              <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold">v0.1.0</span>
            </div>
          </div>
        )}
```
por:
```tsx
        {/* Footer */}
        {!collapsed && (
          <div className="shrink-0 border-t border-border px-5 py-4">
            <button
              onClick={() => setShowChangelog(true)}
              title="Ver novidades"
              className="w-full flex items-center justify-between rounded-lg px-1 py-0.5 hover:bg-background-elevated transition-colors"
            >
              <span className="text-xs text-slate-600">TaskHS</span>
              <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold">v{APP_VERSION}</span>
            </button>
          </div>
        )}
```

- [ ] **Step 4: Renderizar a modal**

Em `MainLayout`, imediatamente antes do `</div>` mais externo que fecha o componente (a última linha `</div>` antes de `  );` no final do arquivo), adicionar:
```tsx
      {showChangelog && <ChangelogModal onClose={() => setShowChangelog(false)} />}
```

- [ ] **Step 5: Versão dinâmica no LoginPage**

Em `frontend/src/pages/LoginPage.tsx`, adicionar o import (junto aos imports do topo):
```tsx
import { APP_VERSION } from "../data/changelog";
```
E substituir a linha 128:
```tsx
          TaskHS · Health & Safety Tech · v0.1.0
```
por:
```tsx
          TaskHS · Health & Safety Tech · v{APP_VERSION}
```

- [ ] **Step 6: Build + verificação no navegador**

Run (de `frontend/`): `npm run build`
Expected: PASSA, sem erros TS.

Depois, com o dev server (`npm run dev`) rodando e logado:
- o rodapé da sidebar mostra `TaskHS` + `v1.0.0` e é clicável (cursor de botão, tooltip "Ver novidades");
- clicar abre a modal com a v1.0.0, selo "Versão atual", data `22/06/2026` e os itens com badges "Novidade";
- fechar funciona por ×, clique fora e Esc;
- a tela de login mostra `… · v1.0.0` (não mais `v0.1.0`).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/layouts/MainLayout.tsx frontend/src/pages/LoginPage.tsx
git commit -m "feat(changelog): botão Ver novidades na sidebar + versão dinâmica

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Convenção no CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (nova seção curta sobre changelog/versionamento)

- [ ] **Step 1: Adicionar a seção**

Em `CLAUDE.md`, adicionar uma seção nova (logo após a seção "## Gotchas importantes", antes de "## Arquitetura do backend"):
```markdown
## Changelog / versionamento (OBRIGATÓRIO)

**Toda mudança no sistema deve terminar com uma entrada nova no changelog** — `frontend/src/data/changelog.ts`. Adicionar um objeto `ChangelogVersion` **no topo** do array `CHANGELOG` (mais recente primeiro), com `version`, `date` (ISO `YYYY-MM-DD`) e os `changes` (cada um `{ kind: "novidade" | "melhoria" | "correcao", text }`). Versionamento semântico: correção → patch (`1.0.x`), melhoria → minor (`1.x.0`), novidade grande → minor/major. A versão exibida no rodapé da sidebar e no LoginPage deriva de `CHANGELOG[0]` (`APP_VERSION`) — basta editar o array, não há string de versão cravada em outro lugar. **Não considerar uma feature/fix concluída sem essa entrada.** O rodapé "TaskHS · vX.Y.Z" da sidebar é um botão ("Ver novidades") que abre o `ChangelogModal` ([frontend/src/components/ChangelogModal.tsx](frontend/src/components/ChangelogModal.tsx)).
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: convenção obrigatória de changelog/versionamento

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notas finais

- Após as 3 tasks: revisão final de branch (subagent-driven → final code review) e **finishing-a-development-branch** (merge na `main` + push), seguindo o fluxo das features anteriores.
- **Esta própria feature** já satisfaz a nova regra: a entrada v1.0.0 do changelog é a entrada da release. (Se quiser, registrar o changelog como item separado numa v1.1.0 — mas como é o lançamento, v1.0.0 cobrindo tudo é coerente.)
