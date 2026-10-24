---
name: bot-whatsapp
description: O bot de lançamento pelo WhatsApp do FinTrack (M11, ADR-018) - o webhook com assinatura, a mensagem uma vez só (wamid), o vínculo por código, o leitor determinístico, o rascunho que vira lançamento no Confirmar, a conta das respostas grátis e a Cloud API de mentira. Use ao mexer em features/bot, lib/whatsapp, packages/core/src/bot*.ts, packages/db/src/bot.ts, no webhook /api/whatsapp/webhook ou em e2e/whatsapp*.ts.
---

# Bot do WhatsApp

Leia antes: `docs/adr/0018-bot-whatsapp.md`. O canvas "FinTrack Visual", linha G, é a referência
visual (Ajustes › Bot, o código de vínculo e as conversas).

## Onde fica cada coisa

| O quê                                                     | Onde                                            |
| --------------------------------------------------------- | ----------------------------------------------- |
| Leitor da mensagem (valor, data, forma, parcelas, nomes)  | `packages/core/src/bot-parse.ts`                |
| Textos das respostas, botões, teto, vínculo, `BotChannel` | `packages/core/src/bot.ts`                      |
| Vínculo, mensagem, rascunho, Confirmar, conta do mês      | `packages/db/src/bot.ts`                        |
| Tabelas                                                   | `packages/db/prisma/schema/bot.prisma`          |
| Assinatura, JSON da Meta, JSON das respostas              | `apps/web/src/lib/whatsapp/protocol.ts`         |
| O canal (fala com a Graph API) e a configuração           | `apps/web/src/lib/whatsapp/{channel,config}.ts` |
| Webhook (a regra) e a fila                                | `apps/web/src/features/bot/server/`             |
| Telas (Ajustes, código, Recebidos › Do WhatsApp)          | `apps/web/src/features/bot/ui/`                 |
| Cloud API de mentira e o papel da pessoa nos testes       | `apps/web/e2e/whatsapp-fake.ts`, `whatsapp.ts`  |

## Regras

1. **O webhook só valida, grava e enfileira.** A assinatura (`validSignature`, corpo cru, tempo
   constante) vem ANTES do `JSON.parse`. Assinatura errada, corpo grande, JSON torto e evento
   desconhecido respondem igual (200, "ok"). Nada de trabalho pesado no webhook.
2. **Uma vez só**: o `wamid` é único em `bot_message`; a fila toma a mensagem (marca como lida e
   apaga o texto) ANTES de qualquer efeito. Repetição da fila não faz nada.
3. **Número não vinculado: nenhuma resposta, nada gravado além da linha de contagem.** Código
   errado: o mesmo silêncio. Nunca use o número vinculado como login.
4. **Nada de LLM** no caminho do bot. Regra nova de leitura vai em `bot-parse.ts`, com teste (e de
   propriedade quando couber). A categoria é a da cascata de sempre.
5. **A resposta só repete o que a pessoa mandou e o que se decidiu sobre ESTE lançamento.** Nunca
   final de cartão, saldo, total, orçamento. Texto novo de resposta vai no `bot.ts` do core e entra
   no teste de privacidade (`bot.test.ts`).
6. **O lançamento nasce no Confirmar**, pelo `createTransaction`/`createInstallmentPurchase`, com os
   crachás de AGORA e `origin: { source: "BOT", externalId: <id do rascunho> }`. Nunca grave um
   `transaction` direto do bot.
7. **Toda resposta reserva o lugar na conta do mês** (`reserveReply`) antes de sair; o "lida"
   (`markRead`) não conta. O bot nunca inicia conversa (template é cobrado).
8. **Logs só com o resultado e contagens** (`event: "bot.message"`, `"webhook.received"`): nunca o
   número, o texto, o wamid ou o token.
9. **Telefones nos testes são inventados** (`+55 41 90000-0xxx`, `fakePhone()`), únicos por teste
   e aparelho. Nenhum arquivo do repositório tem 13 a 19 dígitos seguidos: o teste do número de
   cartão monta o número na hora.
10. **Falha da Meta vai para o log só como código** (`event: "bot.send_failed"`, `status`, `code`,
    `subcode`, `hint` de `META_ERROR_HINTS` em `protocol.ts`), nunca a mensagem de texto da Meta
    (ela pode repetir o número). Código novo que o bot precisa explicar: na tabela, com teste, e
    no runbook.
11. **A versão da Graph API** está no padrão do `WHATSAPP_API_URL` (`env.ts`, hoje `v26.0`). Trocar
    de versão: o padrão, o `.env.example`, o `playwright.config.ts` e o runbook juntos.
12. **A tela do código não empilha endereços**: o botão de dentro dela usa `replace`
    (`StartLinkButton replace`), senão o Fechar (que volta uma página) cai no código anterior.
    Navegação que depende do cliente tem a rede de segurança do `OpenCode` (abre pelo navegador
    se o endereço não mudar).
13. **Relógio dos testes de integração**: `BOT_CLOCK` (21/10/2026 15:00 UTC); a limpeza de 90 dias
    é global, e só o teste dela cria linhas antigas (julho).

## Testar

```bash
pnpm --filter @fintrack/core exec vitest run src/bot          # leitor e regras
pnpm --filter @fintrack/web exec vitest run src/lib/whatsapp  # assinatura, JSON e erros da Meta, o canal
pnpm --filter @fintrack/db exec vitest run --config vitest.integration.config.mts src/integration/bot.integration.test.ts
pnpm --filter @fintrack/web exec playwright test e2e/bot-whatsapp.spec.ts
```

Em casa, para conversar com o bot sem a Meta: `pnpm whatsapp:fake` (porta 8789) e `pnpm dev`; a
pessoa "manda" uma mensagem com
`curl -s 127.0.0.1:8789/__enviar -H 'content-type: application/json' -d '{"de":"5541900000001","texto":"gastei 42,90 no mercado"}'`
e as respostas aparecem em `curl -s '127.0.0.1:8789/__respostas?para=5541900000001'`.
