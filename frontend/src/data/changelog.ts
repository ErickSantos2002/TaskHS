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
    version: "1.13.2",
    date: "2026-07-30",
    changes: [
      { kind: "correcao", text: "Quando alguma tela quebrava, o sistema inteiro sumia e ficava só o fundo em branco, sem explicação. Agora aparece um aviso com o que aconteceu e um botão para recarregar — e a barra lateral continua funcionando, então dá para ir para outra tela sem perder a sessão. Se isso acontecer com você, um print do quadro cinza mostra exatamente onde foi o defeito." },
    ],
  },
  {
    version: "1.13.1",
    date: "2026-07-30",
    changes: [
      { kind: "melhoria", text: "Ao criar ou editar uma etiqueta, a cor agora sai de um seletor completo — o mesmo círculo de cores do sistema, com o código da cor ao lado — em vez das oito opções fixas. Dá para usar exatamente a cor que você quiser." },
    ],
  },
  {
    version: "1.13.0",
    date: "2026-07-30",
    changes: [
      { kind: "novidade", text: "Busca global na barra do topo: encontra cards em todos os quadros a que você tem acesso, de qualquer página. Além do título e da descrição, ela varre os campos de observação que a integração preenche e o texto dos comentários — então dá para achar um atendimento pelo número de série do aparelho, mesmo quando ele só foi escrito na conversa do cartão. Ignora acentos (\"calibracao\" acha \"Calibração\"), aceita várias palavras em qualquer ordem, e o atalho Ctrl+K abre a busca de onde você estiver." },
      { kind: "novidade", text: "Cards arquivados também aparecem no resultado da busca, marcados com o selo \"Arquivado\". Ao abrir um deles, o cartão mostra um aviso no topo com um botão para restaurá-lo direto dali." },
      { kind: "melhoria", text: "Cada pessoa só encontra cards dos quadros de que participa (administradores e coordenadores continuam enxergando todos), e os cartões abrem mais rápido em quadros com muitos comentários." },
    ],
  },
  {
    version: "1.12.4",
    date: "2026-07-30",
    changes: [
      { kind: "melhoria", text: "Dentro de um cartão, a tecla Esc agora fecha o que estiver aberto: primeiro a imagem ampliada, o PDF ou a etapa em destaque; depois sai do campo que estava sendo editado (salvando o que foi digitado); e, por fim, fecha o cartão. Pedido dos usuários." },
    ],
  },
  {
    version: "1.12.3",
    date: "2026-07-22",
    changes: [
      { kind: "melhoria", text: "O título das listas agora aparece por inteiro, quebrando em mais de uma linha quando necessário, em vez de ser cortado com \"…\". Pedido dos usuários — facilita distinguir listas com nomes parecidos e longos." },
    ],
  },
  {
    version: "1.12.2",
    date: "2026-07-22",
    changes: [
      { kind: "correcao", text: "O visualizador de PDF mostrava \"Não foi possível exibir o PDF\" no site publicado, mesmo com o arquivo intacto no servidor. Era o servidor entregando um componente interno do visualizador com o tipo errado, e o navegador o bloqueava. Corrigido — os PDFs voltam a abrir normalmente, sem precisar reenviar nada." },
    ],
  },
  {
    version: "1.12.1",
    date: "2026-07-22",
    changes: [
      { kind: "melhoria", text: "Os anexos agora aceitam arquivos XML (ex.: NF-e), importante para o setor financeiro. Vale mesmo quando o navegador não identifica o tipo do arquivo — o sistema reconhece pelo final \".xml\" do nome." },
    ],
  },
  {
    version: "1.12.0",
    date: "2026-07-22",
    changes: [
      { kind: "melhoria", text: "Agora dá para selecionar e copiar o texto do PDF direto no visualizador — útil para pegar valores, CNPJ, números de OC e etc. de uma proposta sem redigitar. O visualizador continua igual (abrir pelo olho, baixar, fechar), só que o texto passou a ser selecionável em qualquer navegador." },
    ],
  },
  {
    version: "1.11.2",
    date: "2026-07-22",
    changes: [
      { kind: "melhoria", text: "Os comentários de um cartão agora aparecem do mais recente para o mais antigo — o último comentário fica no topo da lista, logo abaixo da caixa de escrever." },
    ],
  },
  {
    version: "1.11.1",
    date: "2026-07-22",
    changes: [
      { kind: "melhoria", text: "Cards novos criados pela integração (GestorHS) agora entram no topo da lista, não mais no fundo — a chegada mais recente fica logo na frente. Quando o GestorHS move um card de uma etapa para outra, o posicionamento continua como antes." },
    ],
  },
  {
    version: "1.11.0",
    date: "2026-07-22",
    changes: [
      { kind: "novidade", text: "O painel do lado direito do cartão agora tem duas abas: \"Comentários\" e \"Atividade\". Na aba Atividade você vê o histórico do cartão — quem criou, moveu (de qual lista para qual), editou, anexou, comentou e etc. — com o nome de quem fez e quando. O histórico já era registrado; agora qualquer membro do quadro consegue vê-lo direto no cartão, sem depender da tela de Logs (que é só de administrador)." },
    ],
  },
  {
    version: "1.10.1",
    date: "2026-07-20",
    changes: [
      { kind: "novidade", text: "Agora dá para anexar arrastando: arraste um arquivo do computador para cima do cartão aberto e solte — aparece um aviso \"Solte para anexar ao cartão\" e o arquivo é enviado. O botão \"+ Adicionar\" continua funcionando para quem preferir escolher pelo explorador." },
    ],
  },
  {
    version: "1.10.0",
    date: "2026-07-20",
    changes: [
      { kind: "novidade", text: "Agora dá para editar e excluir os próprios comentários de um cartão — passe o mouse sobre o comentário e use os botões de lápis e lixeira. Ao editar, o comentário mostra um \"(editado)\" que, ao clicar, revela o texto anterior; nada se perde. Administradores e coordenadores também podem excluir comentários de qualquer pessoa." },
      { kind: "melhoria", text: "Comentário excluído não some da conversa: fica no lugar marcado como \"Comentário excluído\", preservando a ordem da discussão." },
    ],
  },
  {
    version: "1.9.3",
    date: "2026-07-20",
    changes: [
      { kind: "novidade", text: "PDFs anexados agora abrem direto numa janela dentro do TaskHS, pelo botão de olho ao lado do anexo — dá para ler, dar zoom, buscar no texto e imprimir sem precisar baixar. O botão de baixar continua ali para quem quiser o arquivo." },
      { kind: "melhoria", text: "Anexo que não consegue ser baixado agora avisa: a linha fica marcada em vermelho com o motivo (ex.: arquivo indisponível no servidor), em vez de simplesmente não fazer nada ao clicar." },
    ],
  },
  {
    version: "1.9.2",
    date: "2026-07-20",
    changes: [
      { kind: "correcao", text: "No modo claro, o nome \"TaskHS\" no rodapé da barra lateral ficava branco sobre fundo claro e sumia. O mesmo acontecia com o nome da lista dentro do painel de Automações." },
    ],
  },
  {
    version: "1.9.1",
    date: "2026-07-20",
    changes: [
      { kind: "novidade", text: "A tela de Logs agora tem paginação de verdade, com números de página, \"Anterior\"/\"Próxima\" e a contagem de quantos registros você está vendo. Antes só havia \"Carregar mais\", que ia empilhando tudo numa lista sem fim — para chegar a um registro antigo era preciso clicar muitas vezes." },
      { kind: "melhoria", text: "As telas de Usuários e Logs passam a ocupar a largura inteira, igual ao Dashboard e à de Boards, em vez de ficarem espremidas no meio com espaço vazio dos lados." },
      { kind: "melhoria", text: "A janela \"O que há de novo?\" ficou mais larga e mais alta, para caber mais texto sem tanta rolagem." },
      { kind: "correcao", text: "Partes das telas de Usuários, Logs e Login seguiam o tema do Windows em vez do botão de tema do próprio sistema. Quem usava o computador no modo claro e o TaskHS no escuro (ou o contrário) via cores trocadas nessas telas." },
    ],
  },
  {
    version: "1.9.0",
    date: "2026-07-20",
    changes: [
      { kind: "melhoria", text: "Mudanças na estrutura do banco passam a ser aplicadas sozinhas quando o sistema sobe. Antes era preciso lembrar de rodar um comando à mão antes de cada atualização — e quando esse passo era esquecido o sistema saía do ar." },
      { kind: "novidade", text: "Cada quadro pode ter um ícone. Em Configurações do board, logo abaixo da Cor, há uma grade com 32 ícones (pasta, pessoas, gráfico, ferramenta, caminhão, dinheiro, laboratório, capacete, estetoscópio e outros) — escolha um e ele passa a aparecer na grade e na lista de Boards, no Dashboard e no cabeçalho do quadro, pintado com a cor do quadro. Dá para reconhecer o quadro sem precisar ler o nome. Quem preferir, é só usar \"Sem ícone\" para voltar ao símbolo padrão." },
    ],
  },
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
