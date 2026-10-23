# ADR-018: O bot de lançamento pelo WhatsApp

- Status: aceita
- Data: 2026-10-22
- Módulo: M11.1 (desenho no canvas, linha G, aprovada em 21/10/2026)

## Contexto

O roteiro do M11 pede lançar um gasto por mensagem ("gastei 42,90 no mercado"). Só o WhatsApp
(o Telegram ficou de fora em 21/10), com a premissa de **nenhum gasto**. A documentação da Meta
conferida em 21/10/2026 diz: cada número comercial tem **1.000 mensagens de serviço grátis por
mês** (resposta dentro da janela de 24 h aberta pela pessoa), desde 1º/10/2026; **sem forma de
pagamento cadastrada, a Meta para de entregar** o que passa do grátis; template (mensagem que o
bot inicia) é sempre cobrado. O número de teste da Meta manda mensagens para até 5 destinatários
verificados, sem custo. Bibliotecas que automatizam o WhatsApp Web violam os termos.

Este é o primeiro módulo em que texto de lançamento **sai do servidor**: a mensagem e a resposta
passam pela Meta.

## Decisão

Decidido pelo Danillo em 21/10/2026 (as recomendações), com a linha G do canvas aprovada:

1. **Três entregas.** M11.1 (este): o núcleo com a Cloud API de mentira, em produção com o bot
   desligado; M11.2: o painel da Meta e o número de teste, em produção; M11.3 (opcional): um
   número próprio, só se houver um número livre que não esteja no WhatsApp.
2. **Só a Cloud API oficial**, atrás de um contrato (`BotChannel` no core): a leitura, o vínculo,
   a idempotência e a confirmação não conhecem o WhatsApp. A Cloud API de mentira
   (`apps/web/e2e/whatsapp-fake.ts`) faz o papel da Meta nos testes, no CI e no laboratório.
3. **O webhook** (`/api/whatsapp/webhook`, a única rota pública nova) confere a assinatura
   `X-Hub-Signature-256` sobre o corpo CRU antes de ler o JSON (comparação em tempo constante),
   recusa corpo acima de 64 KB, grava cada mensagem **uma vez só pelo wamid** e põe na fila
   (pg-boss). Responde 200 na hora, igual para assinatura errada, JSON torto e evento
   desconhecido (a resposta não ensina nada); sem a configuração, responde 404.
4. **Vínculo por código**: 6 dígitos gerados na web (logado, 2FA e prova de identidade dos
   últimos 10 minutos), válidos por 10 minutos e uma vez só, mandados como "vincular 482 913".
   Código errado ou vencido: o mesmo silêncio de um número desconhecido; cinco erros do mesmo
   número numa hora = 24 h ignorado. Um número por pessoa e uma pessoa por número. O número
   vinculado **nunca vira login**.
5. **Número não vinculado: nenhuma resposta.** Fica uma linha sem texto e sem dono, só para contar.
6. **A mensagem vira um rascunho (`bot_draft`), não um lançamento.** O Confirmar (o botão do
   WhatsApp ou Recebidos › Do WhatsApp) cria o lançamento pelo **mesmo caminho do formulário**
   (`createTransaction` ou `createInstallmentPurchase`, com os crachás de agora), com `source BOT`
   e o id do rascunho como `externalId` (nas parcelas, `:1`, `:2`...): dois cliques nunca lançam
   duas vezes (a chave única do banco recusa). Assim "em 3x" nasce como compra parcelada de
   verdade, e o lançamento confirmado é "seu": quando o banco mandar a mesma compra, o M09.2 sugere
   o par. Essa foi uma mudança de estrutura sobre a proposta (que dizia `PENDING`), avisada ao
   Danillo antes do código.
7. **O leitor é determinístico** (`packages/core/src/bot-parse.ts`): valor brasileiro, hoje/ontem/
   anteontem/dia 19/19/10, crédito/débito/pix, "em 3x" (2 a 24), o cartão pelo apelido e o
   ambiente pelo nome. **Nenhum LLM no caminho do bot**: a mensagem é dado, nunca instrução. A
   categoria vem da cascata de sempre (regras, histórico, banco, classificador).
8. **O que a resposta repete**: valor, data, a descrição lida, a categoria, o ambiente, a forma e o
   **apelido** do cartão. Nunca o final do cartão, saldo, total, orçamento ou outro lançamento (um
   teste confere todos os textos). Mensagem com 13 a 19 dígitos (parece cartão): recusada antes de
   tudo, sem ecoar o número e sem guardar nada.
9. **O que fica guardado**: o número só como HMAC-SHA256 (chave derivada do `BETTER_AUTH_SECRET`
   por HKDF) e os 4 últimos dígitos; o texto da mensagem **cifrado** (AES-256-GCM, a mesma chave
   `CONNECTION_SECRET_KEYS` do M09.1) só até a fila ler, e apagado em seguida (CHECK no banco);
   as mensagens somem em 90 dias. Nada do texto, do número ou do lançamento vai para o log.
10. **A conta das respostas grátis** (`bot_reply_count`, por número do bot e mês de São Paulo):
    cada resposta reserva o lugar ANTES de sair (UPDATE condicional: várias filas ao mesmo tempo
    nunca passam do teto). Em **850**, um aviso único e o modo essencial (a confirmação vira o
    "lida", que não é mensagem); em **900**, silêncio até o mês virar. Os lançamentos continuam
    chegando em Recebidos.
11. **O fluxo**: Confirmar, Cancelar e Desfazer (30 minutos) pelos botões; os botões valem 24 h
    (a janela da Meta); sem resposta, a proposta fica em Recebidos, fora das somas. O bot **nunca
    inicia conversa** (template é cobrado).
12. **Os padrões** de cada pessoa (ambiente, conta do débito/pix, cartão do crédito) ficam em
    Ajustes › Bot do WhatsApp; a mensagem troca por nome ("na casa", "no master"). Ambíguo ou sem
    padrão: o bot pergunta com botões (até 3).
13. **O interruptor do lar** (`household.botDisabledAt`, ação `manage_bot` da matriz): desligado,
    o bot não lê nem responde.

## Consequências

- Uma migração aditiva (`*_bot_whatsapp`): seis tabelas novas, `household.botDisabledAt` e seis
  CHECKs à mão (o número só como HMAC, o texto apagado ao ler, rascunho só de despesa com parcelas
  só no crédito, a conta de 0 a 1000).
- Sete variáveis novas, todas opcionais (`WHATSAPP_*`): sem as quatro do painel da Meta, o bot fica
  desligado no servidor. O M11.1 vai para a produção assim; o M11.2 grava os valores.
- `lib/jobs.ts` passou a criar todas as filas do app num lugar só (as do banco e as do bot).
- `transactions.ts` e `installments.ts` aceitam uma **origem** (`source` + `externalId`): o
  formulário continua MANUAL.
- O interruptor virou um componente comum (`components/visual/switch-button.tsx`), usado pela IA
  local e pelo bot.
- Diferenças conscientes do canvas G: a seção "Do WhatsApp" no topo de Recebidos (não desenhada; o
  mesmo padrão da E.2); as dicas dos padrões usam os nomes de verdade do lar; o "900 para" encosta
  na borda direita do medidor (a 90 % vazava a 320 px).

## Alternativas consideradas

- **Bibliotecas não oficiais (WhatsApp Web)**: fora, violam os termos e o número pode ser banido.
- **O lançamento `PENDING` direto**: compra parcelada não cabe num recebido, e o par com o que o
  banco manda depois não seria sugerido (dois recebidos nunca formam par).
- **LLM para ler a mensagem**: fora (os 10 s do M07, o risco de injeção do ADR-016, e o leitor
  determinístico cobre o que o Danillo escreve).
- **Guardar o texto da mensagem**: não há uso para ele depois de lido; guardá-lo só aumentaria o
  que um backup expõe.
- **Coexistência (o mesmo número no app WhatsApp Business e na API)**: exige ser parceiro da Meta.

## Adendo (M11.2, 22/10/2026): a Cloud API de verdade, no número de teste

Decidido pelo Danillo em 22/10/2026 (as recomendações, e a Nelcimara junto):

1. **O número de teste da Meta**, com o app em **modo de desenvolvimento**: até 5 números
   cadastrados na lista do número de teste (cada um confirma com um código). Usam o bot o Danillo e a
   Nelcimara; cada um vincula o próprio número pela própria conta. Modo de desenvolvimento não pede
   política de privacidade, verificação do negócio nem forma de pagamento.
2. **Token permanente** de um usuário do sistema (Business Settings › System users, validade
   "Never", permissões `whatsapp_business_messaging` e `whatsapp_business_management`). O token de
   teste da página API Setup vence em 24 h e nunca vai para o servidor.
3. **A versão da Graph API passa para a `v26.0`** (lançada em 29/7/2026; a `v23.0` do M11.1 vence em
   8/10/2027). Só o padrão do `WHATSAPP_API_URL` muda; a troca seguinte está no runbook.
4. **Falha da Meta só no log**, como código (`bot.send_failed` com `status`, `code`, `subcode` e um
   nome curto, como `fora_da_lista_de_teste` para o 131030). Nenhuma tela nem migração nova. O texto
   do erro da Meta nunca vai para o log (pode repetir o número de quem recebe).
5. **O "9" dos celulares brasileiros**: em vários DDDs (o 41 entre eles) o WhatsApp identifica o
   número sem o 9, e a lista do número de teste compara o formato exato. O bot responde sempre para
   o número como a Meta mandou (`from`); se a Meta recusar com 131030, o número entra na lista
   também sem o 9 (runbook). Não dá para provar no laboratório (sem acesso à Meta).
6. **Cloudflare**: o "Bot Fight Mode" do plano grátis pode barrar o POST da Meta e não aceita
   exceção; o manual confere com um POST de fora antes de ligar no painel da Meta.

O check do M11.2 prova o webhook pela internet sem mandar mensagem: a verificação com o token certo
devolve o desafio, e um POST com assinatura forjada recebe 200 sem gravar nada.
