# Identidade Visual — TaskHS
> Baseada no sistema HelpHS. Use este documento como referência para manter consistência visual entre os dois sistemas.

---

## 1. Paleta de Cores

### Primária — Cyan/Sky Blue
| Shade | Hex |
|-------|-----|
| 50 | `#f0f9ff` |
| 100 | `#e0f2fe` |
| 200 | `#bae6fd` |
| 300 | `#7dd3fc` |
| 400 | `#38bdf8` |
| **500 (DEFAULT)** | **`#0ea5e9`** |
| 600 | `#0284c7` |
| 700 | `#0369a1` |
| 800 | `#075985` |
| 900 | `#0c4a6e` |

### Status / Semânticas
| Estado | Hex | Uso |
|--------|-----|-----|
| Success | `#10b981` (emerald-500) | Concluído, ativo |
| Danger | `#ef4444` (red-500) | Erro, urgente |
| Warning | `#f59e0b` (amber-500) | Atenção |
| Info | `#3b82f6` (blue-500) | Informação |

### Backgrounds (CSS Variables)
| Variável | Light | Dark |
|----------|-------|------|
| `--bg-base` | `#f8fafc` (slate-50) | `#0d1b2a` (deep navy) |
| `--bg-surface` | `#ffffff` | `#132238` (navy) |
| `--bg-elevated` | `#f1f5f9` (slate-100) | `#1a2f4a` (lighter navy) |

### Texto
| Classe | Light | Dark |
|--------|-------|------|
| `text-slate-100` | `#0f172a` | `#f1f5f9` |
| `text-slate-200` | `#1e293b` | `#e2e8f0` |
| `text-slate-300` | `#334155` | `#cbd5e1` |
| `text-slate-400` | `#475569` | `#94a3b8` |
| `text-slate-500` | `#64748b` | `#64748b` |

### Bordas (CSS Variables)
| Variável | Light | Dark |
|----------|-------|------|
| `--border-color` | `#e2e8f0` (slate-200) | `#1e3a5f` |
| `--border-muted` | `#f1f5f9` (slate-100) | `#132238` |

### Cores de Charts / Boards
| Nome | Hex |
|------|-----|
| Abertos / Primary | `#0ea5e9` |
| Em Andamento | `#6366f1` (indigo) |
| Aguardando | `#f59e0b` (amber) |
| Resolvidos | `#10b981` (emerald) |
| Fechados | `#64748b` (slate) |
| Cancelados | `#ef4444` (red) |

---

## 2. Tipografia

**Font Family:** `"Plus Jakarta Sans"` (Google Fonts, weights 300–800)
**Fallback:** `ui-sans-serif, system-ui, sans-serif`

```html
<!-- Adicionar no index.html -->
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
```

| Peso | Valor | Uso |
|------|-------|-----|
| Light | 300 | Subtítulos sutis |
| Regular | 400 | Corpo de texto |
| Medium | 500 | Labels, hints |
| Semibold | 600 | Headings, card titles |
| Bold | 700 | Títulos de página |
| Extrabold | 800 | Logo, destaque |

| Escala | Tamanho | Uso |
|--------|---------|-----|
| `text-xs` | 12px | Badges, hints |
| `text-sm` | 14px | Body, labels |
| `text-base` | 16px | Padrão |
| `text-lg` | 18px | Subtítulos |
| `text-xl` | 20px | Títulos de seção |

---

## 3. Espaçamentos e Bordas

### Border Radius
| Classe | Valor | Uso |
|--------|-------|-----|
| `rounded-lg` | 8px | Botões, badges, inputs |
| `rounded-xl` | 12px | Cards, modais |
| `rounded-full` | 9999px | Avatares, badges pill |

### Paddings comuns
| Contexto | Classe |
|----------|--------|
| Card padrão | `p-4` |
| Card pequeno | `p-3` |
| Card grande | `p-6` |
| Input / Button | `px-3 py-2` |
| Button md | `px-4 py-2` |
| Modal header/footer | `px-6 py-4` |

### Gaps comuns
`gap-1` · `gap-1.5` · `gap-2` · `gap-2.5` · `gap-3` · `gap-4` · `gap-6`

---

## 4. Componentes

### Button
```
Variantes: primary | secondary | danger | ghost
Tamanhos:  sm | md | lg

primary:   bg-[#0ea5e9]  hover:bg-[#0284c7]  text-white
secondary: bg-elevated   text-slate-100
danger:    bg-red-500    hover:bg-red-600     text-white
ghost:     bg-transparent  hover:bg-elevated  text-slate-300

Tamanhos:
  sm: px-3 py-1.5 text-xs rounded-lg
  md: px-4 py-2   text-sm rounded-lg
  lg: px-6 py-3   text-base rounded-lg

Disabled: opacity-50 cursor-not-allowed
Loading:  spinner inline
Focus:    focus-visible:ring-2 ring-primary
```

### Input / Textarea / Select
```
border border-[--border-color] rounded-lg px-3 py-2
bg-[--bg-surface] text-slate-100 placeholder-slate-500
hover: border-slate-500
focus: ring-2 ring-[#0ea5e9] border-transparent
error: border-red-500 ring-red-500
```

### Badge
```
Formato: rounded-full px-2.5 py-0.5 text-xs font-medium
Background: bg-{color}/20
Border:     border border-{color}/30

Variantes: primary | secondary | danger | warning | info | success | muted
```

### Card
```
border border-[--border-color] rounded-xl bg-[--bg-surface]
CardHeader: border-b px-4 py-3
CardTitle:  text-base font-semibold text-slate-100
```

### Alert
```
Tipos: info | success | warning | danger
bg-{color}/10 border border-{color}/30 rounded-lg p-4
Ícone SVG stroke, stroke-width=2
```

### Modal
```
Backdrop: bg-black/60 backdrop-blur-sm z-50
Panel:    rounded-xl border bg-[--bg-surface] shadow-xl
Animação: animate-in fade-in zoom-in-95 duration-150
Tamanhos: sm | md | lg | xl | 2xl
```

### Avatar
```
Tamanhos: xs(24px) | sm(32px) | md(40px) | lg(48px)
rounded-full
Fallback: iniciais com cor determinística por nome
```

### Spinner
```
Tamanhos: sm | md | lg
animate-spin border-2 rounded-full
border-slate-700 border-t-[#0ea5e9]
```

---

## 5. Ícones

**Estilo:** SVG inline customizado, stroke-based (Heroicons-inspired)
```tsx
<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} className="w-5 h-5">
  ...
</svg>
```

**Tamanhos:** `w-4 h-4` (small) · `w-5 h-5` (padrão)
**Stroke width:** 1.75px (nav) · 2px (alerts/modais)

> Para o TaskHS: pode usar **Lucide React** que segue o mesmo estilo stroke. `strokeWidth={1.75}` nos ícones de nav.

---

## 6. Layout

### Estrutura
```
├── Sidebar (fixed, z-30 mobile / auto desktop)
│   ├── Logo
│   ├── Nav items (hover:bg-elevated, rounded-lg)
│   └── (collapse em mobile)
├── Main
│   ├── Topbar (h-16, z-20, border-b)
│   │   ├── Menu toggle
│   │   ├── Notifications bell
│   │   ├── Theme toggle (dark/light switch)
│   │   └── User menu
│   └── Content (flex-1, overflow-y-auto, p-4 md:p-6)
```

### Dimensões
| Elemento | Valor |
|----------|-------|
| Sidebar expandida | 256px (w-64) |
| Sidebar colapsada | 72px |
| Topbar height | 64px (h-16) |
| Content padding | `p-4` mobile / `p-6` desktop |

### Z-index
| Camada | Valor |
|--------|-------|
| Topbar | z-20 |
| Sidebar (mobile) | z-30 |
| Modais / Overlays | z-50 |

### Breakpoints
- **Mobile first**
- `md` (768px): sidebar estática, layout 2+ colunas

---

## 7. Dark Mode

**Padrão:** Dark mode ativado por padrão.
**Persistência:** `localStorage` com chave `helphs-theme`.
**Implementação:** classe `.dark` no `<html>`.

```html
<!-- Script no index.html para evitar flash -->
<script>
  var t = localStorage.getItem("taskhs-theme");
  if (t !== "light") document.documentElement.classList.add("dark");
</script>
```

```tsx
// ThemeContext
const isDark = localStorage.getItem("taskhs-theme") !== "light"
document.documentElement.classList.toggle("dark", isDark)
```

---

## 8. Animações e Transições

```
transition-colors duration-150   — hover em botões, links, rows
transition-all duration-200       — nav items, inputs
transition-[width] duration-300   — sidebar collapse
animate-in fade-in zoom-in-95 duration-150  — modais
animate-spin                      — spinners
```

---

## 9. CSS Variables (index.css)

```css
:root {
  --bg-base: rgb(248 250 252);
  --bg-surface: rgb(255 255 255);
  --bg-elevated: rgb(241 245 249);
  --border-color: rgb(226 232 240);
  --border-muted: rgb(241 245 249);
}

.dark {
  --bg-base: rgb(13 27 42);
  --bg-surface: rgb(19 34 56);
  --bg-elevated: rgb(26 47 74);
  --border-color: rgb(30 58 95);
  --border-muted: rgb(19 34 56);
}
```

---

## 10. Dependências a instalar no TaskHS

```bash
npm install lucide-react
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
npm install react-hot-toast
npm install react-router-dom
npm install axios
npm install date-fns
```

---

## 11. Arquivos de referência no HelpHS

| Arquivo | O que contém |
|---------|-------------|
| `tailwind.config.js` | Cores, font, extends |
| `src/index.css` | CSS variables light/dark, scrollbar |
| `index.html` | Google Fonts + theme detection script |
| `src/contexts/ThemeContext.tsx` | Dark mode provider |
| `src/lib/utils.ts` | Função `cn()` para merge de classes |
| `src/components/layout/AppLayout.tsx` | Layout principal |
| `src/components/layout/Sidebar.tsx` | Sidebar |
| `src/components/layout/Topbar.tsx` | Topbar |
| `src/components/ui/Button.tsx` | Botão |
| `src/components/ui/Input.tsx` | Input |
| `src/components/ui/Badge.tsx` | Badges |
| `src/components/ui/Card.tsx` | Card |
| `src/components/ui/Alert.tsx` | Alertas |
| `src/components/ui/Modal.tsx` | Modal |
| `src/components/ui/Avatar.tsx` | Avatar |
| `src/components/ui/Table.tsx` | Tabelas |
| `src/components/ui/Spinner.tsx` | Spinner |
