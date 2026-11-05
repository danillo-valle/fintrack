// O manual do usuário do FinTrack (M12.3a, ADR-022): os artigos da Ajuda, tela por tela. Texto
// puro com **negrito**, sem HTML: o mesmo conteúdo serve à página, ao modal do "?" e à busca.
//
// Regra: cada tela do app aponta para um artigo (o `help` do PageHeader, conferido no tipo e no
// help.test.ts). Mudou uma tela? Atualize o artigo dela no mesmo PR.

export type HelpBlock =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "steps"; items: readonly string[] }
  | { kind: "list"; items: readonly string[] }
  | { kind: "faq"; q: string; a: string };

export type HelpTopicId =
  "comecar" | "lancamentos" | "banco" | "painel" | "contas" | "bot" | "conta";

export type HelpTopic = { id: HelpTopicId; title: string; icon: HelpTopicIcon };
export type HelpTopicIcon = "book" | "receipt" | "landmark" | "pie" | "tags" | "chat" | "shield";

export const HELP_TOPICS: readonly HelpTopic[] = [
  { id: "comecar", title: "Começar", icon: "book" },
  { id: "lancamentos", title: "Lançamentos", icon: "receipt" },
  { id: "banco", title: "Do banco", icon: "landmark" },
  { id: "painel", title: "Orçamento e painel", icon: "pie" },
  { id: "contas", title: "Contas e categorias", icon: "tags" },
  { id: "bot", title: "Bot de lançamento", icon: "chat" },
  { id: "conta", title: "Sua conta", icon: "shield" },
];

export type HelpArticle = {
  slug: string;
  title: string;
  topic: HelpTopicId;
  /** Uma frase: aparece no índice e no topo do artigo */
  summary: string;
  /** A tela que o artigo explica (o "Ir para a tela"); null quando não há uma só */
  screen: string | null;
  body: readonly HelpBlock[];
};

export const HELP_ARTICLES = [
  // ── Começar ────────────────────────────────────────────────────────────────────────────
  {
    slug: "primeiro-acesso",
    title: "Primeiro acesso: conta, e-mail e 2FA",
    topic: "comecar",
    summary:
      "Criar a conta, confirmar o e-mail, ligar o código do celular e guardar os códigos de backup.",
    screen: null,
    body: [
      {
        kind: "p",
        text: "Leva uns 5 minutos, uma vez só. Depois, entrar pede a senha e o código do celular.",
      },
      {
        kind: "steps",
        items: [
          "**Ser convidado.** O FinTrack é da casa: só os e-mails autorizados por quem cuida dele criam conta. Use o mesmo e-mail do convite.",
          "**Criar a conta.** Em Criar conta, diga o seu nome, o e-mail e uma senha. Uma frase que só você conhece é mais forte que uma palavra com símbolos. Senhas que já vazaram na internet são recusadas.",
          "**Confirmar o e-mail.** Chega um e-mail com um link. Ele confirma a conta e já abre o próximo passo. O link vale por uma hora.",
          "**Ligar o 2FA.** Instale um app autenticador no celular (Google Authenticator, 2FAS ou o do seu gerenciador de senhas), leia o QR code e digite o código de 6 números.",
          "**Guardar os códigos de backup.** São 10 códigos para entrar se você perder o celular. Guarde num lugar seguro: cada um vale uma vez só.",
        ],
      },
      {
        kind: "faq",
        q: "Apareceu “Não deu para conferir a senha agora”.",
        a: "O serviço que verifica senhas vazadas não respondeu a tempo. Nada foi criado: espere alguns segundos e tente de novo com a mesma senha.",
      },
      {
        kind: "faq",
        q: "Perdi o celular do 2FA.",
        a: "Na tela de entrar, depois da senha, use **Usar um código de backup**. Depois, em Ajustes › Segurança, ligue o 2FA no celular novo.",
      },
    ],
  },
  {
    slug: "lar-e-carteiras",
    title: "O lar e as carteiras",
    topic: "comecar",
    summary: "O lar junta as pessoas da casa; cada carteira mostra só o que é dela.",
    screen: "/carteiras",
    body: [
      {
        kind: "p",
        text: "O **lar** é a casa: as pessoas que dividem as contas. Cada pessoa tem a sua **carteira pessoal**, que só ela vê, e o lar pode ter carteiras **compartilhadas**, como “Casa”, com quem participa delas. No lançamento e na lista, a carteira aparece como **Ambiente**: é a mesma coisa.",
      },
      { kind: "h", text: "Quem pode o quê" },
      {
        kind: "list",
        items: [
          "**Dono** da carteira: lança, edita, cria contas e cartões, convida e arquiva.",
          "**Editor**: lança e edita os lançamentos.",
          "**Leitor**: só vê.",
        ],
      },
      { kind: "h", text: "Convidar alguém para o lar" },
      {
        kind: "steps",
        items: [
          "Em Ajustes › Lar, toque em **Convidar** e digite o e-mail da pessoa.",
          "Mande o link do convite para ela. Ele vale por 72 horas.",
          "Ela cria a conta (o e-mail precisa estar autorizado) e abre o link para entrar no lar.",
        ],
      },
      {
        kind: "faq",
        q: "Abri a carteira de outra pessoa pelo link e apareceu “Página não encontrada”.",
        a: "É de propósito: uma carteira que não é sua aparece igual a uma que não existe. Peça para a pessoa te incluir nela.",
      },
    ],
  },
  {
    slug: "lancar-um-gasto",
    title: "Lançar um gasto em 10 segundos",
    topic: "comecar",
    summary: "Valor, descrição e pronto: o resto vem preenchido e a categoria é sugerida.",
    screen: "/lancamentos/novo",
    body: [
      {
        kind: "steps",
        items: [
          "Toque em **Novo lançamento**, no topo de qualquer tela.",
          "Digite o valor e a descrição (“mercado”, “padaria”). A categoria aparece sugerida.",
          "Confira de onde saiu o dinheiro (conta, cartão ou pix) e de quem é o gasto (o **Ambiente**, que é a carteira).",
          "Toque em **Salvar**.",
        ],
      },
      {
        kind: "p",
        text: "Em **Tipo da despesa**, escolha **Parcelada** para uma compra em várias vezes no cartão ou **Conta fixa / Assinatura** para algo que se repete todo mês.",
      },
      {
        kind: "faq",
        q: "A categoria sugerida está errada.",
        a: "Troque antes de salvar. A sua escolha ensina o FinTrack, e da próxima vez a sugestão melhora. Em Ajustes › Categorias você também pode criar uma regra.",
      },
    ],
  },
  // ── Lançamentos ────────────────────────────────────────────────────────────────────────
  {
    slug: "lancamentos",
    title: "Lançamentos: uma conta por vez",
    topic: "lancamentos",
    summary:
      "O que entrou e saiu de cada conta (corrente, poupança), com o saldo; o cartão fica em Cartões.",
    screen: "/lancamentos",
    body: [
      {
        kind: "p",
        text: "**Lançamentos** mostra só o que passou pelas contas que não são cartão: débito, Pix, boletos, salário. As abas no alto escolhem a conta (**Conta corrente**, **Poupança**). As compras no cartão de crédito ficam em **Cartões**, por fatura, e nunca aparecem misturadas com o débito.",
      },
      {
        kind: "p",
        text: "O resumo traz o **saldo no começo do período**, as **entradas**, as **saídas** e o **saldo hoje** (numa conta ligada ao banco, o que o banco informa). Transferências (para a poupança, para alguém do lar) e o pagamento das faturas aparecem na lista, porque saíram da conta, mas ficam fora das entradas e das saídas.",
      },
      { kind: "h", text: "Filtrar" },
      {
        kind: "list",
        items: [
          "**Período**: marque um ou vários meses, ou use os atalhos (este mês, mês passado, últimos 3 meses).",
          "**Pago por**: marque uma ou várias pessoas; **Todos** tira o filtro.",
          "**Filtros**, no canto da lista, abre categoria, tipo e busca pela descrição. **CSV** exporta o que está na lista.",
          "O endereço guarda os filtros: dá para salvar nos favoritos ou mandar o link.",
        ],
      },
      {
        kind: "p",
        text: "Cada saída tem a etiqueta do tipo: **Fixa**, **Variável** ou **Parcela**. Toque nela para trocar entre Fixa e Variável (veja **Fixa ou variável**).",
      },
      { kind: "h", text: "Os meses que vêm" },
      {
        kind: "p",
        text: "Com um período de hoje em diante (este mês ou um mês que ainda vai chegar), a conta mostra o **previsto**: as **entradas previstas** (o salário que se repete), as **saídas previstas** (as fixas da conta) e as **faturas a pagar** pelos cartões que ela paga (o que já chegou na fatura e o que está previsto nela). Nada disso é lançamento: quando a cobrança chega do banco, ela toma o lugar da prevista.",
      },
      {
        kind: "p",
        text: 'No mês de hoje, **O previsto e o que chegou** mostra o que chegou diferente do previsto: "Previsto R$ 9.940,00 · chegou R$ 90,00 a menos".',
      },
      {
        kind: "p",
        text: "Quando você chega aqui por um número do Início ou do Orçamento (Mercado em novembro, por exemplo), a lista mostra o número em **duas partes**: **Nas contas** e **Nos cartões**, por fatura, cada uma com o seu total. A soma das duas é o número que você tocou.",
      },
      {
        kind: "faq",
        q: "Por que uma compra de outubro no cartão aparece em novembro?",
        a: "No cartão, cada compra conta no mês em que a **fatura vence**, que é quando o dinheiro sai da conta. Uma compra depois do fechamento entra na fatura seguinte.",
      },
      {
        kind: "faq",
        q: "Apaguei um lançamento sem querer.",
        a: "Logo depois de apagar aparece **Desfazer**. Use enquanto o aviso estiver na tela.",
      },
    ],
  },
  {
    slug: "cartoes",
    title: "Cartões: uma fatura por vez",
    topic: "lancamentos",
    summary:
      "As compras de cada cartão de crédito, fatura por fatura, com o vencimento, o limite e a conferência.",
    screen: "/cartoes",
    body: [
      {
        kind: "p",
        text: "**Cartões** mostra um cartão e uma fatura por vez. As setas ao lado do título passam para a fatura anterior e para a próxima; ela abre na fatura que ainda vai vencer.",
      },
      {
        kind: "list",
        items: [
          "**Fatura até agora** soma tudo o que o banco vai cobrar nela, inclusive o que ainda espera revisão. O estorno abate.",
          "**Fixas**, **Parcelas** e **Variáveis** dividem a fatura; as abas da lista mostram cada parte.",
          "A compra conta no mês em que a fatura **vence**: é assim que o Início e o Orçamento somam.",
          "Na lista, a categoria e o **O que foi** mudam em um toque. O botão da categoria mostra também o tipo (**Fixa** ou **Variável**), que se troca no mesmo painel.",
        ],
      },
      {
        kind: "p",
        text: "Quando o banco ou o PDF fecha a fatura, aparecem o total, os encargos (IOF, juros) e a **conferência ao centavo**. A fatura paga diz quando e de qual conta saiu o pagamento.",
      },
      { kind: "h", text: "A próxima fatura, antes de abrir" },
      {
        kind: "p",
        text: "Passe pela seta para as faturas que ainda não abriram: aparece **o que já se sabe** delas, as **Parcelas previstas** (as que faltam de cada compra parcelada) e as **Fixas previstas** (as assinaturas que se repetem). **Previsto até agora** soma as duas. Na fatura aberta, as previstas que ainda não chegaram aparecem em **Previstas nesta fatura**; a que passou do dia sem chegar diz **Não chegou**.",
      },
    ],
  },
  {
    slug: "parcelada-e-fixa",
    title: "Fixas e compras parceladas",
    topic: "lancamentos",
    summary:
      "As contas que se repetem todo mês e as compras parceladas, com o que ainda falta pagar.",
    screen: "/fixas",
    body: [
      {
        kind: "p",
        text: "**Fixas e parcelas**, no menu, junta o que se repete e o que ainda vai ser cobrado: as **entradas fixas** (o salário), as **saídas fixas** (aluguel, escola, assinaturas) e as **parceladas em andamento**, com quantas parcelas faltam, quanto ainda falta pagar e quando termina. As abas **Entradas**, **Saídas fixas** e **Parceladas** mostram uma parte só.",
      },
      { kind: "h", text: "A fixa que chega do banco" },
      {
        kind: "p",
        text: "Toda saída **Fixa** que chega do banco e você confirma passa a ser prevista nos meses seguintes, sozinha: o valor é o último que chegou, por volta do mesmo dia, sem data para acabar. Quando a do mês seguinte chega, ela toma o lugar da prevista. Marcar a compra como **Variável** tira ela da previsão.",
      },
      {
        kind: "p",
        text: "O salário entra quando você diz: abra o lançamento e, em **Tipo da receita**, escolha **Fixa**. Em **Repete todo mês** você escolhe o valor previsto (**O último**, **Média de 3 meses** ou **Um valor fixo**), **Quando cai** (por volta de um dia ou no 5º dia útil, por exemplo) e **Até quando**.",
      },
      { kind: "h", text: "Mudar o valor e parar" },
      {
        kind: "p",
        text: "No **⋯** de cada fixa: **Mudar o valor** troca a regra do valor, o dia e o fim, e mostra os últimos que chegaram; **Parar de repetir** tira dos próximos meses e não apaga nada que já aconteceu.",
      },
      { kind: "h", text: "Uma fixa sem banco" },
      {
        kind: "p",
        text: "No **Novo lançamento**, a aba **Recorrência**: conta fixa, assinatura ou entrada, o valor por mês, o dia e até quando. **Lançar as deste mês** cria, agendado, o lançamento de cada uma (sem repetir o que já existe).",
      },
      { kind: "h", text: "Compra parcelada" },
      {
        kind: "p",
        text: 'No Novo lançamento com cartão de crédito, escolha **Parcelada** e o número de vezes (de 2 a 24): uma parcela em cada fatura, e os centavos que sobram vão na primeira. A parcela que o banco informa ("02/05") também aparece aqui. A parcela de agora é a da próxima fatura; a compra some da lista quando a última chega.',
      },
      {
        kind: "p",
        text: "Quando o banco não informa a parcela, abra a compra e, em **Tipo da despesa**, escolha **Parcelada**: diga a **Parcela** e o total (**de**). As que faltam ficam previstas nas próximas faturas, e a cobrança do mês seguinte, da mesma loja e valor, vira a parcela seguinte sozinha.",
      },
    ],
  },
  {
    slug: "fixa-ou-variavel",
    title: "Fixa ou variável",
    topic: "lancamentos",
    summary:
      "O tipo de cada saída: pela categoria, trocado numa compra e nas próximas da mesma loja.",
    screen: null,
    body: [
      {
        kind: "p",
        text: "Toda saída tem um tipo: **Fixa** (a assinatura, a escola: todo mês, quase o mesmo valor), **Variável** (o mercado, o posto: muda com o uso) ou **Parcela** (a compra parcelada, sempre Parcela). O tipo decide como a saída entra no **previsto do mês**: a fixa e a parcela entram uma vez; só a variável segue o ritmo do mês.",
      },
      { kind: "h", text: "De onde vem o tipo" },
      {
        kind: "list",
        items: [
          "Da **categoria**: em Ajustes › Categorias, no **⋯** › **Editar**, escolha se as despesas dela são **Fixas** ou **Variáveis** por padrão.",
          "Da **compra**: toque na etiqueta **Fixa** ou **Variável** da linha (em Lançamentos), no botão da categoria (em Cartões e em Recebidos) ou em **Tipo da despesa**, na página do lançamento.",
          "As que vêm de uma **recorrência** do app são fixas.",
        ],
      },
      {
        kind: "p",
        text: "Trocar o padrão da categoria muda as compras dela que você não marcou à mão; as que você marcou ficam como estão. A fixa que chega do banco fica **prevista** nos meses seguintes (veja **Fixas e compras parceladas**); a próxima cobrança continua vindo do banco e toma o lugar da prevista.",
      },
      { kind: "h", text: "As próximas desta loja também" },
      {
        kind: "p",
        text: "Ao trocar a categoria ou o tipo, marque **As próximas de NETFLIX.COM também** (com o texto do banco da compra). O que chegar do banco com o mesmo texto já vem com a categoria e o tipo. Na seção **Tipo** da página da compra, a mesma regra se chama **Este tipo também nas próximas de NETFLIX.COM**. Isso é uma regra: aparece em Ajustes › Categorias, em **Regras**, e pode ser apagada lá.",
      },
    ],
  },
  {
    slug: "transferencia",
    title: "Transferência entre contas",
    topic: "lancamentos",
    summary: "Dinheiro que sai de uma conta sua e entra em outra, sem contar como gasto.",
    screen: "/lancamentos/novo?aba=transferencia",
    body: [
      {
        kind: "p",
        text: "No **Novo lançamento**, a aba **Transferência**: escolha de onde sai, para onde vai, o valor e a data. Use para pix entre as suas contas, guardar na poupança, saque, e para **pagar a fatura** do cartão (da conta corrente para a conta do cartão). A transferência vira dois lançamentos ligados e não entra nas somas de entradas e saídas.",
      },
    ],
  },
  {
    slug: "exportar",
    title: "Exportar para planilha",
    topic: "lancamentos",
    summary: "Os lançamentos filtrados num arquivo CSV que o Excel abre.",
    screen: "/lancamentos/exportar",
    body: [
      {
        kind: "p",
        text: "A exportação leva exatamente o que os filtros da lista mostram, no formato do Excel brasileiro (ponto e vírgula, vírgula nos centavos). Como o arquivo tem os seus dados, o FinTrack pede a sua senha de novo antes de gerar.",
      },
    ],
  },
  // ── Do banco ───────────────────────────────────────────────────────────────────────────
  {
    slug: "meu-pluggy",
    title: "Conectar o Meu Pluggy",
    topic: "banco",
    summary: "Saldo, faturas e compras do banco entrando sozinhos, uma vez por dia.",
    screen: "/ajustes/conexoes",
    body: [
      {
        kind: "p",
        text: "O **Meu Pluggy** é gratuito para uso pessoal e lê os seus bancos. O FinTrack busca os dados todo dia de madrugada e quando você toca em **Buscar agora**.",
      },
      {
        kind: "steps",
        items: [
          "No site do Meu Pluggy, conecte os seus bancos e copie o Client ID e o Client Secret.",
          "Em Ajustes › Conexões bancárias, toque em **Conectar o Meu Pluggy** e cole os dois. O segredo fica cifrado.",
          "Ligue cada conta do banco a uma conta do FinTrack (ou crie uma nova).",
        ],
      },
      {
        kind: "p",
        text: "Tudo o que vem do banco entra como **Recebido** e fica fora das somas até você conferir. A fatura aberta é calculada; a fechada, conferida ao centavo.",
      },
      {
        kind: "faq",
        q: "Uma compra do adicional foi para o cartão principal.",
        a: "O banco mandou um final de cartão que não está cadastrado. Em Recebidos aparece o aviso: cadastre o cartão com esse final e as compras vão para quem usa.",
      },
    ],
  },
  {
    slug: "recebidos",
    title: "Recebidos: confirmar e juntar pares",
    topic: "banco",
    summary: "Conferir o que veio do banco, um a um ou em lote, e juntar com o que você já lançou.",
    screen: "/lancamentos/recebidos",
    body: [
      {
        kind: "p",
        text: "Em **Recebidos** fica o que o banco mandou e ainda não foi conferido. Nada disso entra nas somas antes do seu **Confirmar**.",
      },
      {
        kind: "list",
        items: [
          "**Par sugerido**: o banco mandou algo que você já lançou (mesmo valor, até 5 dias). Confirmar o par junta os dois: o texto do banco fica e a sua descrição vira o **O que foi**.",
          "**Transferência entre suas contas**: a saída de uma conta e a entrada na outra, do mesmo valor. Confirmar liga os dois lados, que saem das somas de gasto e de receita. Quando a entrada cai num cartão, é o **pagamento da fatura**: não conta como gasto, porque as compras já contam pelo cartão.",
          "**Sem par**: escolha a categoria e confirme. Os que já têm categoria podem ir juntos em **Confirmar os N**. No painel da categoria, **Tipo da despesa** (Fixa ou Variável) e **As próximas de X também** valem junto; **Aplicar** salva o tipo sem trocar a categoria.",
          "**Estorno**: ligue ao original para os dois se anularem.",
        ],
      },
      { kind: "h", text: "O que foi" },
      {
        kind: "p",
        text: "Ao lado da categoria, **O que foi** guarda o nome que você dá à compra (“Sapato da Zara” para “MERCADOLIVRE*MERCA03/03”). Ele aparece em destaque, com o texto do banco embaixo, e a busca acha pelos dois. Numa parcela, vale para todas as parcelas da compra, e as próximas já chegam com ele.",
      },
      { kind: "h", text: "É transferência, mas o outro lado não aparece" },
      {
        kind: "p",
        text: "Quando o dinheiro foi para a conta de alguém do lar (que você não vê) ou para uma conta sua fora do FinTrack, abra **Escolher categoria** e toque em **Para alguém do lar** ou **Para uma conta minha fora do FinTrack**. O recebido sai das somas quando você confirmar. Para voltar atrás, toque em **Desmarcar** ou escolha uma categoria.",
      },
      {
        kind: "faq",
        q: "Confirmei errado.",
        a: "Por 30 minutos aparece **Desfazer**, para quem confirmou.",
      },
    ],
  },
  {
    slug: "importar",
    title: "Importar extrato ou fatura em PDF",
    topic: "banco",
    summary: "Um arquivo OFX do banco ou o PDF da fatura do cartão, conferidos antes de entrar.",
    screen: "/lancamentos/importar",
    body: [
      {
        kind: "steps",
        items: [
          "Em Lançamentos › Importar, escolha o arquivo **.ofx** (extrato) ou o **.pdf** da fatura.",
          "Se o PDF tiver senha, digite: ela é usada na hora e nunca guardada.",
          "Confira a conta sugerida e o que vai entrar. Na fatura, o FinTrack confere o total ao centavo.",
          "Toque em **Importar**. Os lançamentos chegam como Recebidos.",
        ],
      },
      {
        kind: "p",
        text: "Nada entra duas vezes: o que já veio pelo Meu Pluggy ou por outro arquivo é reconhecido. O arquivo em si é descartado; fica só uma impressão digital dele.",
      },
    ],
  },
  // ── Orçamento e painel ─────────────────────────────────────────────────────────────────
  {
    slug: "inicio",
    title: "Início e o resumo do mês",
    topic: "painel",
    summary:
      "Os números do mês, o que foge do costume e o caminho de cada número até os lançamentos.",
    screen: "/",
    body: [
      {
        kind: "p",
        text: "O topo do Início traz até **três observações** do mês: um orçamento que deve estourar, um gasto acima do costume e uma conta fixa nova. Do dia 1 ao 5, o resumo é do mês anterior, já fechado.",
      },
      {
        kind: "p",
        text: "**Todo número leva à lista** dos lançamentos que o formam, e a lista soma o mesmo valor.",
      },
      {
        kind: "p",
        text: "**Resultado do mês** junta tudo uma vez só: as **entradas** nas contas, as **saídas** (o que saiu das contas mais as faturas que vencem no mês) e o que **sobra**. No cartão, cada compra conta no mês em que a fatura vence. O pagamento da fatura e as transferências entre as suas contas não entram, porque não são gasto nem receita.",
      },
      {
        kind: "p",
        text: "**Previsto para** o mês mostra quanto deve sair até o fim do mês, em três partes: as **Fixas** (uma vez cada: as que já chegaram, e as do mês passado que ainda vão chegar, pelo valor de lá), as **Parcelas** (a parcela do mês de cada compra) e as **Variáveis** (o que já saiu, no ritmo do mês). Fixa ou variável vem da categoria, e você troca em cada compra.",
      },
      {
        kind: "p",
        text: "**Na conta hoje** mostra só a conta corrente: o que dá para gastar agora, e quanto sobra **depois das faturas** que ainda vencem no mês. A poupança fica em **Guardado**, com o que mudou no mês. **Faturas a pagar** mostra a fatura de cada cartão que vence agora; o pagamento da fatura anterior não abate a fatura aberta.",
      },
      {
        kind: "p",
        text: "**Próximos meses** mostra os quatro meses que vêm, só com o que se repete: o que **Entra**, as **Fixas da conta**, a **Fatura do cartão** (as fixas e as parcelas previstas e o que já chegou nela) e a **Sobra antes das variáveis**. O nome do mês leva aos lançamentos dele, com as previstas. O Fluxo de caixa de 6 meses continua em Orçamento.",
      },
    ],
  },
  {
    slug: "orcamento",
    title: "Orçamento por pessoa",
    topic: "painel",
    summary: "Quanto cada categoria pode gastar no mês, por carteira e por pessoa.",
    screen: "/orcamento",
    body: [
      {
        kind: "steps",
        items: [
          "Em Orçamento, toque em **Editar valores** e diga quanto cada categoria pode gastar.",
          "Numa carteira compartilhada, divida o valor por pessoa (e um pedaço Compartilhado).",
          "No mês seguinte, **Copiar de** traz os valores do mês anterior; **Desfazer** volta.",
        ],
      },
      {
        kind: "p",
        text: "O **previsto** soma o que já foi gasto, o que está agendado, as fixas e as parcelas que ainda vão chegar (uma vez cada) e o ritmo do mês, só nas variáveis. Use o orçamento da categoria de cima ou das de baixo, não os dois.",
      },
    ],
  },
  {
    slug: "fluxo-e-evolucao",
    title: "Fluxo de caixa e evolução",
    topic: "painel",
    summary: "Seis meses de entradas e saídas e cada categoria mês a mês.",
    screen: "/orcamento/fluxo",
    body: [
      {
        kind: "p",
        text: "O **Fluxo de caixa** mostra o resultado de cada mês: o cartão conta no mês em que a fatura vence, e as fixas e as parcelas que ainda não vieram aparecem previstas (**Fixas e parcelas por vir**).",
      },
      {
        kind: "p",
        text: "A **Evolução** mostra uma categoria em 6, 12 ou 24 meses, para ver se o gasto subiu ou desceu.",
      },
    ],
  },
  // ── Contas e categorias ────────────────────────────────────────────────────────────────
  {
    slug: "contas-e-cartoes",
    title: "Contas e cartões",
    topic: "contas",
    summary: "De onde o dinheiro sai e para onde entra, e os cartões de cada conta.",
    screen: "/ajustes/contas",
    body: [
      {
        kind: "p",
        text: "Cada **conta** é um lugar de onde o dinheiro sai ou entra: conta corrente, poupança, cartão de crédito, vale ou dinheiro. A conta pertence a uma carteira, e só quem é dono da carteira cria ou arquiva.",
      },
      { kind: "h", text: "Criar uma conta" },
      {
        kind: "steps",
        items: [
          "Toque em **Nova conta**, no topo.",
          "Dê um nome que você reconheça (“Conta corrente”, “Cartão Aurora”) e escolha o tipo e a carteira.",
          "No cartão de crédito, diga o dia em que a fatura fecha e o dia em que vence.",
          "Toque em **Criar conta**. O aviso verde no topo confirma, e a conta nova aparece marcada na lista.",
        ],
      },
      { kind: "h", text: "Adicionar um cartão" },
      {
        kind: "steps",
        items: [
          "Na conta de cartão de crédito (ou de vale), toque em **Adicionar cartão**.",
          "Digite só os **4 últimos dígitos**. O FinTrack nunca pede o número inteiro, a validade ou o código de segurança.",
          "Diga quem usa o cartão. É assim que a lista mostra de quem é cada compra.",
        ],
      },
      {
        kind: "p",
        text: "Cada cartão aparece com as **iniciais de quem usa**, se é físico ou virtual, se é adicional e se é de compras conjuntas. Quando as compras do banco não entram no ambiente da conta, a última linha diz onde entram.",
      },
      { kind: "h", text: "Editar um cartão" },
      {
        kind: "steps",
        items: [
          "No cartão, toque em **⋯** e depois em **Editar cartão**.",
          "Mude o apelido, a bandeira, o tipo, **quem usa**, se é adicional ou de compras conjuntas.",
          "Em **Compras do banco entram em**, escolha o ambiente (a Casa, por exemplo). Só aparecem os ambientes de que quem usa participa.",
          "Toque em **Salvar**. Os recebidos ainda não confirmados desse cartão vão para o ambiente escolhido; o que já foi confirmado não muda.",
        ],
      },
      {
        kind: "p",
        text: "O final não se edita: outro final é outro cartão. No mesmo **⋯** ficam **Marcar como compras conjuntas** e **Arquivar**.",
      },
      {
        kind: "faq",
        q: "As duas contas do banco vieram com o mesmo nome.",
        a: "Na conta, toque em **⋯** e em **Editar conta** para dar um apelido (“Itaú · Poupança”). O nome novo aparece em todo lugar. Contas ligadas daqui em diante já chegam com o tipo no nome.",
      },
      {
        kind: "faq",
        q: "Criei a mesma conta duas vezes. E agora?",
        a: "Arquive a repetida. Ela some das escolhas, e os lançamentos dela continuam onde estão.",
      },
      {
        kind: "faq",
        q: "O que é “compras conjuntas”?",
        a: "Marque um cartão assim quando ele é da casa: em Pago por, as compras dele aparecem como Compartilhado.",
      },
    ],
  },
  {
    slug: "categorias-e-regras",
    title: "Categorias e regras",
    topic: "contas",
    summary: "O que é cada gasto e as regras que categorizam sozinhas.",
    screen: "/ajustes/categorias",
    body: [
      {
        kind: "p",
        text: "As **categorias** são do lar inteiro e podem ter subcategorias (Alimentação › Mercado). Uma categoria em uso não se apaga: arquive.",
      },
      {
        kind: "p",
        text: "Uma **regra** diz: descrição que contém, começa com ou é igual a um texto vai para tal categoria. Regras vêm antes de tudo na sugestão. Ao trocar a categoria ou o tipo de uma compra, **As próximas de X também** cria (ou muda) a regra para você, e ela passa a dar também o tipo (fixa ou variável).",
      },
      {
        kind: "p",
        text: "No **⋯** de cada categoria, **Editar** muda o nome, o tipo e se as despesas dela são **Fixas** ou **Variáveis** por padrão. O tipo (despesa ou receita) só muda numa categoria sem subcategorias, sem orçado e sem conta fixa, e com todos os lançamentos do tipo novo.",
      },
      { kind: "h", text: "Categorias que eram transferência" },
      {
        kind: "p",
        text: "Quando uma categoria parece guardar transferências (o resgate da poupança, o Pix entre as suas contas), o topo da tela avisa. **Revisar** mostra os pares que o FinTrack achou (de onde saiu → para onde foi) e os que ficam sem o outro lado. **Tratar os N como transferência** tira esses lançamentos do gasto e da receita; os sem o outro lado viram transferência para uma conta sua fora do FinTrack. Por 30 minutos aparece **Desfazer**: tudo volta como estava, com a categoria.",
      },
      {
        kind: "faq",
        q: "Digitei uma categoria e ela não aparece, mas diz que já existe.",
        a: "O nome não se repete no lar, nem entre despesa e receita. O seletor de um gasto só mostra despesas: se o nome existe como receita, ele avisa e leva até ela, para você editar.",
      },
    ],
  },
  {
    slug: "por-que-essa-categoria",
    title: "Por que essa categoria?",
    topic: "contas",
    summary: "Quem sugeriu cada categoria, em que ordem, e quanto se categoriza sozinho.",
    screen: "/ajustes/categorizacao",
    body: [
      { kind: "p", text: "A sugestão passa por camadas, em ordem, e para na primeira que decide:" },
      {
        kind: "steps",
        items: [
          "**Regras** que você criou.",
          "**Histórico**: o que você escolheu antes para a mesma loja.",
          "**Categoria do banco**, quando o banco manda uma.",
          "**Classificador**, treinado com as suas escolhas (só sugere com 80% ou mais de confiança).",
          "**IA local**, à noite, só para o que veio do banco e ficou sem categoria (se estiver ligada).",
        ],
      },
      {
        kind: "p",
        text: "Em Recebidos, **Por que essa categoria?** mostra a camada que decidiu. Em Ajustes › Categorização, você vê quanto se categoriza sem IA e pode **Treinar agora**.",
      },
    ],
  },
  {
    slug: "ia-local",
    title: "A IA local, à noite",
    topic: "contas",
    summary: "Uma IA que roda no servidor de casa, de madrugada, e só sugere: quem decide é você.",
    screen: "/ajustes/categorizacao",
    body: [
      {
        kind: "p",
        text: "A **IA local** fica desligada até alguém ligar em Ajustes › Categorização. Ligada, ela olha de madrugada (das 04:45 às 06:45) o que veio do banco e ficou sem categoria. Nada sai do servidor de casa.",
      },
      {
        kind: "p",
        text: "A sugestão dela aparece em Recebidos com a etiqueta **IA local** e nunca é confirmada sozinha: confirme uma a uma. Quando nenhuma categoria serve, ela pode propor uma nova; **Criar e aplicar** cria e aplica nos recebidos com a mesma proposta.",
      },
    ],
  },
  // ── Bot ────────────────────────────────────────────────────────────────────────────────
  {
    slug: "bot-vincular",
    title: "Vincular o WhatsApp ou o Telegram",
    topic: "bot",
    summary: "Ligar o seu número ou a sua conta do Telegram ao bot de lançamento.",
    screen: "/ajustes/bot",
    body: [
      {
        kind: "steps",
        items: [
          "Em Ajustes › Bot de lançamento, toque em **Vincular** no canal que você usa e confirme a senha.",
          "No **Telegram**, toque em **Abrir no Telegram** e depois em Iniciar. No **WhatsApp**, mande o código de 6 números para o número do bot.",
          "A tela muda sozinha quando o bot responde “Pronto”. O código vale por 10 minutos.",
        ],
      },
      {
        kind: "p",
        text: "Em **O que o bot usa quando você não diz**, escolha a carteira, a conta do débito e pix e o cartão de crédito padrão.",
      },
    ],
  },
  {
    slug: "bot-escrever",
    title: "Como escrever um gasto",
    topic: "bot",
    summary: "Valor, o que foi e, se quiser, a data, a forma de pagamento e a carteira.",
    screen: "/ajustes/bot",
    body: [
      { kind: "p", text: "Escreva como falaria: **gastei 42,90 no mercado**. O bot entende:" },
      {
        kind: "list",
        items: [
          "Data: “ontem”, “anteontem”, “dia 5” ou “05/10”.",
          "Forma: “no crédito”, “no débito”, “no pix”, “em 3x”.",
          "Cartão pelo apelido: “no master”. Carteira pelo nome: “na casa”.",
        ],
      },
      {
        kind: "p",
        text: "Nunca mande o número do cartão: o bot recusa a mensagem e não repete o número.",
      },
    ],
  },
  {
    slug: "bot-confirmar",
    title: "Confirmar, cancelar e desfazer",
    topic: "bot",
    summary: "O gasto só vale depois do seu Confirmar; dá para desfazer por 30 minutos.",
    screen: "/lancamentos/recebidos",
    body: [
      {
        kind: "p",
        text: "O bot responde com a proposta e os botões **Confirmar** e **Cancelar**. Só o Confirmar cria o lançamento. Depois dele, **Desfazer** funciona por 30 minutos.",
      },
      { kind: "p", text: "Não tocou em nada? A proposta espera em Recebidos › Do bot." },
    ],
  },
  // ── Sua conta ──────────────────────────────────────────────────────────────────────────
  {
    slug: "seguranca",
    title: "Senha, 2FA e códigos de backup",
    topic: "conta",
    summary: "Trocar a senha, refazer o 2FA e gerar códigos de backup novos.",
    screen: "/ajustes/seguranca",
    body: [
      {
        kind: "p",
        text: "Em Ajustes › Segurança, **Trocar a senha** pede a atual e manda um e-mail de aviso; os outros aparelhos saem. Esqueceu a senha? Use **Esqueci a senha** na tela de entrar: o link chega por e-mail e vale uma hora.",
      },
      {
        kind: "p",
        text: "O **2FA** é obrigatório. Trocou de celular? Use um código de backup para entrar e ligue o 2FA de novo. Quando os códigos de backup estiverem acabando, use **Gerar códigos novos**.",
      },
    ],
  },
  {
    slug: "passkeys",
    title: "Passkeys",
    topic: "conta",
    summary: "Entrar com a digital ou o rosto, sem digitar a senha.",
    screen: "/ajustes/seguranca",
    body: [
      {
        kind: "p",
        text: "Em Ajustes › Segurança, **Adicionar passkey** guarda uma chave neste aparelho (ou no seu gerenciador de senhas). Depois, na tela de entrar, **Entrar com passkey**. Ela resiste a sites falsos: só funciona no endereço do FinTrack.",
      },
    ],
  },
  {
    slug: "sessoes",
    title: "Sair dos outros aparelhos",
    topic: "conta",
    summary: "Ver onde a sua conta está aberta e fechar o que não reconhecer.",
    screen: "/ajustes/seguranca",
    body: [
      {
        kind: "p",
        text: "Quem está na sessão aparece sempre: as **iniciais** no pé do menu lateral (no computador) ou no canto de cima (no celular). Toque nelas para ver o nome e o e-mail, ir para Senha, 2FA e sessões ou **Sair** deste aparelho.",
      },
      {
        kind: "p",
        text: "Em Ajustes › Segurança, a lista de **sessões** mostra cada aparelho com a conta aberta. **Encerrar** fecha uma; **Encerrar todas as outras** fecha todas menos a deste aparelho. Não reconheceu uma? Encerre e troque a senha.",
      },
    ],
  },
] as const satisfies readonly HelpArticle[];

export type HelpSlug = (typeof HELP_ARTICLES)[number]["slug"];

export function helpArticle(slug: string): HelpArticle | null {
  return HELP_ARTICLES.find((a) => a.slug === slug) ?? null;
}

/** O texto puro de um artigo (sem os **), para a busca. */
export function articleText(article: HelpArticle): string {
  const parts: string[] = [article.title, article.summary];
  for (const b of article.body) {
    if (b.kind === "p" || b.kind === "h") parts.push(b.text);
    else if (b.kind === "faq") parts.push(b.q, b.a);
    else parts.push(...b.items);
  }
  return parts.join("\n").replaceAll("**", "");
}
