# ADR-019: O Telegram como segundo canal do bot

- Status: aceita
- Data: 2026-10-24
- Módulo: M12.0b (desenho no canvas, linha H, aprovada em 24/10/2026)

## Contexto

O bot do WhatsApp (ADR-018) foi para a produção com um número fornecido pela Meta. Em 23/10 ele
respondeu por cerca de uma hora e passou a ter toda resposta recusada com o código **131037** (o
nome de exibição do número sem aprovação). O nome aparece como `AVAILABLE_WITHOUT_REVIEW`, pedir o
mesmo nome não abre revisão, e a aprovação pode depender da verificação da empresa, que pede
documento. Enquanto isso, as mensagens chegam e viram proposta, mas o bot não consegue responder.

Em 21/10 o Telegram tinha ficado de fora. Em 24/10 o Danillo reabriu essa decisão: "Vamos incluir
o Telegram para o envio junto com o Whatsapp... vamos enviando via Telegram até o estabelecimento
do Whatsapp". A Bot API do Telegram é grátis, não pede número de telefone, revisão de nome nem
forma de pagamento, e o bot é criado no @BotFather em um minuto.

## Decisão

Decidido pelo Danillo em 24/10/2026 (as recomendações), com a linha H do canvas aprovada:

1. **Os dois canais juntos**, cada pessoa vincula um, outro ou os dois. A leitura, o rascunho, o
   Confirmar, os crachás e os textos são os mesmos (o contrato `BotChannel` do core); o canal só
   muda quem é quem e como a resposta sai. Ajustes › Bot do WhatsApp vira **Ajustes › Bot de
   lançamento**: o interruptor do lar e os padrões são comuns; o cartão "Seus canais" tem uma linha
   por canal. Recebidos › Do WhatsApp vira **Recebidos › Do bot**.
2. **Vínculo em um toque**: o botão "Abrir no Telegram" leva o código no link
   (`https://t.me/<bot>?start=<código>`); no Telegram, a pessoa toca em Iniciar e o bot recebe
   `/start <código>`. O "vincular 123 456" digitado continua valendo como reserva. O código é o
   mesmo do WhatsApp (10 minutos, uso único, prova de identidade recente); `bot_link_code.usedChannel`
   diz por qual canal ele chegou.
3. **Do Telegram só se guarda o HMAC do id da conversa** (`bot_telegram_link.chatHash`, a mesma chave
   dos números, com o prefixo `telegram:`): nem o nome, nem o @, nem o id. A tela mostra "Vinculado
   desde 24/10". A conta vinculada nunca vira login.
4. **O webhook** (`/api/telegram/webhook`, a única rota pública nova) confere o cabeçalho
   `X-Telegram-Bot-Api-Secret-Token` (o segredo do `setWebhook`) em tempo constante **antes de ler
   o corpo**, lê no máximo 64 KB e responde igual (200, "ok") para segredo errado, corpo grande,
   JSON torto e update desconhecido. Só entram conversas privadas (grupo, canal, mensagem editada e
   mensagem de outro bot são ignorados). O id da mensagem é `tg:` + o `update_id` (o mesmo campo
   único do WhatsApp; um CHECK garante que os ids dos dois canais nunca colidem).
5. **A proposta se atualiza**: depois do Confirmar, a MESMA mensagem vira "Lançado" com o Desfazer, e
   os botões somem (`editMessageText`); nada de botão velho na conversa. O WhatsApp, que não edita,
   continua mandando uma mensagem nova. Os botões do Telegram cabem nos 64 bytes do
   `callback_data` com os uuids em base64url.
6. **Quem não está vinculado**: mensagem comum = silêncio, como no WhatsApp. O `/start` sem código,
   com código errado ou vencido recebe uma frase só, que não diz qual dos casos ("Este bot é de uso
   particular. Para vincular, gere um código em Ajustes › Bot de lançamento"): no Telegram qualquer
   pessoa acha o bot pela busca, e o Iniciar sem resposta confunde. Cinco erros numa hora: 24 h de
   silêncio.
7. **Número de cartão**: no Telegram o bot **apaga a mensagem da pessoa** da conversa (mensagem
   recebida há menos de 48 h) e diz isso; nada é guardado. No WhatsApp, que não deixa apagar, a
   resposta de sempre.
8. **Sem teto de respostas no Telegram** (a conta das grátis é só do número do WhatsApp). O
   WhatsApp ganhou a última resposta aceita e a última recusada em `bot_reply_count`: a tela avisa
   quando a Meta está recusando tudo (o 131037 tem texto próprio).
9. **Diferença consciente do canvas**: o canvas mostra o Desfazer sumindo sozinho depois de 30
   minutos. Para isso o servidor teria de guardar o id da conversa aberto até lá; ficou assim: o
   botão continua, e o toque depois do prazo troca a mensagem para "Passou de 30 minutos" e o botão
   some.

## Consequências

- Variáveis novas (opcionais): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
  `TELEGRAM_BOT_USERNAME` e `TELEGRAM_API_URL` (padrão `https://api.telegram.org`). Sem as três
  primeiras, o Telegram fica desligado e a rota responde 404. Os valores de verdade só em
  `/srv/fintrack/app.env`, com o `fintrack-definir`.
- O token do bot vai no endereço de cada chamada da Bot API (`/bot<token>/<método>`): o canal nunca
  loga o endereço; o erro do Telegram vira só código e um nome curto (`bot.send_failed`).
- As mensagens também passam pelos servidores de outra empresa: conversa com bot no Telegram não tem
  criptografia de ponta a ponta. Pela Cloud API do WhatsApp é igual (a Meta processa o texto). As
  regras de sempre continuam: texto cifrado e apagado ao ler, nada de texto em log, nenhum LLM.
- O Telegram de mentira (`apps/web/e2e/telegram-fake.ts`, porta 8790) faz o papel da Bot API e da
  pessoa nos testes, no CI e no laboratório; nenhum teste fala com o Telegram.
- Migração aditiva `*_canal_telegram`: a tabela `bot_telegram_link`, as colunas `bot_message.channel`,
  `bot_link_code.usedChannel` e as três de `bot_reply_count`, e quatro CHECKs.
