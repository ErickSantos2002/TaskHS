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
    version: "1.0.1",
    date: "2026-06-22",
    changes: [
      { kind: "melhoria", text: "Modal de automações redesenhada, com regras no formato \"Quando → Então\" e botão para ligar/desligar." },
      { kind: "melhoria", text: "Rodapé da barra lateral com o nome em destaque e o crédito da Health & Safety Tech." },
    ],
  },
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
