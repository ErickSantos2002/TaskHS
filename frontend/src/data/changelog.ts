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
    version: "1.8.3",
    date: "2026-07-20",
    changes: [
      { kind: "melhoria", text: "A cor da lista agora tinge a coluna inteira (faixa no topo, contorno e fundo), em vez de colorir só o nome. O título volta a ser branco/escuro conforme o tema, ficando mais fácil de ler, e dá para identificar as etapas do quadro de longe." },
      { kind: "correcao", text: "No modo claro as listas ficavam com um fundo escuro e um gradiente vazando por trás — agora o fundo acompanha o tema (claro no modo claro, escuro no modo escuro) e o gradiente sumiu." },
      { kind: "melhoria", text: "A borda das listas ficou mais visível, separando melhor uma coluna da outra." },
      { kind: "correcao", text: "A barra de rolagem sumia no modo claro por ser quase branca; agora é cinza nos dois temas." },
    ],
  },
  {
    version: "1.8.2",
    date: "2026-07-18",
    changes: [
      { kind: "correcao", text: "Agora dá para arrastar o quadro para os lados segurando o mouse em cima dos próprios cartões, e não só no espaço vazio. Clicar no cartão continua abrindo ele normalmente, e mover o cartão de lista continua sendo pela alcinha do canto superior direito." },
    ],
  },
  {
    version: "1.8.1",
    date: "2026-07-18",
    changes: [
      { kind: "melhoria", text: "Permissões ajustadas para a rotina da empresa: criar e importar quadro, adicionar/renomear/mudar cor/arquivar/excluir listas e gerenciar etiquetas passam a ser só de administradores e coordenadores — as listas são etapas do fluxo e não devem mudar à toa. Membros continuam trabalhando normalmente nos cartões (criar, mover, comentar, checklists, anexos e marcar etiquetas que já existem)." },
    ],
  },
  {
    version: "1.8.0",
    date: "2026-07-17",
    changes: [
      { kind: "novidade", text: "O quadro agora atualiza em tempo real: quando alguém (ou a integração) move, cria, arquiva ou edita um cartão, listas ou etiquetas, todo mundo que está com o quadro aberto vê na hora, sem precisar atualizar a página. O cartão aberto também sincroniza ao vivo, sem apagar o que você está digitando." },
    ],
  },
  {
    version: "1.7.1",
    date: "2026-07-17",
    changes: [
      { kind: "melhoria", text: "Nas observações de integração, links agora aparecem como um \"Abrir link\" azul clicável (abre em nova aba), em vez do endereço completo — que podia ficar enorme." },
    ],
  },
  {
    version: "1.7.0",
    date: "2026-07-17",
    changes: [
      { kind: "novidade", text: "Observações de integração: quadros que recebem dados de outro sistema (ex.: GestorHS) agora mostram esses dados em botões acima da descrição — um por etapa (Recebido, Laboratório, etc.) — que abrem uma janelinha com o texto. A descrição volta a ser 100% sua. Ligue e nomeie as etapas nas Configurações do quadro." },
    ],
  },
  {
    version: "1.6.0",
    date: "2026-07-17",
    changes: [
      { kind: "melhoria", text: "A integração com outros sistemas (GestorHS) agora identifica a lista pelo id, não pelo nome. Antes, renomear uma lista fazia os cards passarem a cair num quadro novo criado em silêncio; agora o sistema avisa na hora que o id não existe." },
      { kind: "correcao", text: "Excluir uma lista cujo cartão tivesse lembrete dava erro. Agora funciona." },
    ],
  },
  {
    version: "1.5.0",
    date: "2026-07-17",
    changes: [
      { kind: "novidade", text: "Marque pessoas nos comentários: digite @ e escolha alguém do quadro. A pessoa recebe uma notificação de que foi mencionada, e o nome aparece destacado no comentário." },
      { kind: "melhoria", text: "Comentários agora aceitam até 20 mil caracteres — cabe uma thread de e-mail colada. Se algo impedir o envio, a tela passa a dizer o motivo em vez de não fazer nada." },
    ],
  },
  {
    version: "1.4.1",
    date: "2026-07-16",
    changes: [
      { kind: "correcao", text: "Cartões voltaram a mostrar TODOS os membros, comentários, etiquetas, anexos e checklists. Havia uma falha que fazia cada cartão exibir apenas um item de cada — e impedia excluir um quadro que tivesse um cartão assim." },
      { kind: "correcao", text: "Só quem é membro do quadro pode ser atribuído a um cartão, como no Trello. Antes dava para atribuir qualquer pessoa da empresa, e ela recebia notificação e lembretes de um cartão que não conseguia abrir." },
      { kind: "correcao", text: "Remover alguém de um quadro agora tira essa pessoa dos cartões dela ali e apaga os lembretes pessoais dela no quadro. A tela avisa quantos cartões serão afetados antes de confirmar." },
      { kind: "correcao", text: "Mover ou copiar um cartão para outro quadro agora deixa para trás quem não é membro do quadro de destino, e as etiquetas que não existem lá." },
      { kind: "correcao", text: "Notificações de comentário e lembretes de vencimento só vão para quem é membro do quadro." },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-07-16",
    changes: [
      { kind: "novidade", text: "Todos os quadros da empresa agora aparecem na listagem: os que você não participa vêm com cadeado, mostrando quem são os membros e com quem falar para pedir acesso." },
      { kind: "novidade", text: "Configurações do board agora tem a seção Membros do quadro, para adicionar e remover pessoas — antes não havia nenhuma tela para isso." },
      { kind: "correcao", text: "Correção de segurança: quadros de que você não é membro agora ficam realmente inacessíveis. Antes, qualquer pessoa logada conseguia abrir qualquer quadro pelo endereço e ler listas, cards, comentários e anexos." },
      { kind: "correcao", text: "Correção de segurança: só o dono do quadro, administradores e coordenadores podem gerenciar os membros. Antes, qualquer pessoa podia se adicionar a qualquer quadro, inclusive como dona." },
      { kind: "correcao", text: "Correção de segurança: não é mais possível mover, copiar ou alterar cards, checklists, etiquetas e anexos de um quadro do qual você não participa." },
      { kind: "correcao", text: "Membros comuns voltaram a conseguir atribuir pessoas aos cards — o seletor de membros ficava travado em \"Carregando…\" para quem não era administrador." },
      { kind: "correcao", text: "Copiar um cartão que tivesse etiquetas dava erro e não copiava. Agora funciona." },
    ],
  },
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
