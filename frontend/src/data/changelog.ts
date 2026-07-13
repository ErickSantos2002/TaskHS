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
    version: "1.3.1",
    date: "2026-07-13",
    changes: [
      { kind: "melhoria", text: "As listas do quadro agora ocupam a altura toda até o rodapé: a rolagem para ver os demais cards acontece dentro da lista, não na página." },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-07-13",
    changes: [
      { kind: "novidade", text: "Auditoria completa: o sistema registra quem fez cada alteração (até adicionar ou remover uma etiqueta), além de logins e tentativas bloqueadas." },
      { kind: "novidade", text: "Nova página Logs (exclusiva do Administrador) com filtros por pessoa, ação, tipo, período, busca e paginação." },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-06-26",
    changes: [
      { kind: "novidade", text: "Novo perfil Coordenador: faz tudo que o Administrador faz, exceto gerenciar Administradores (e áreas exclusivas de Administrador)." },
    ],
  },
  {
    version: "1.1.1",
    date: "2026-06-26",
    changes: [
      { kind: "melhoria", text: "Integração: sistemas externos podem arquivar/desarquivar um card (ex.: OS cancelada no GestorHS arquiva o card)." },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-06-22",
    changes: [
      { kind: "novidade", text: "Integração com sistemas externos: o GestorHS (e outros) podem abrir e atualizar cards automaticamente via API." },
    ],
  },
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
