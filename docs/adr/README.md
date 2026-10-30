# Decisões de arquitetura (ADR)

Cada arquivo registra uma decisão: o contexto, o que foi decidido, as alternativas e as
consequências. Decisões não são apagadas; quando mudam, um ADR novo substitui o antigo
e o antigo passa a ter status "substituída por ADR-00X".

Modelo para um ADR novo: copie `0001-stack-e-monorepo.md` e troque o conteúdo.

| Nº  | Decisão                                                                                                                     | Status | Revisão de 28/10 (M12.3b)    |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------- |
| 001 | [Stack principal e monorepo](0001-stack-e-monorepo.md)                                                                      | aceita | vale                         |
| 002 | [Design system, tokens e dinheiro em centavos](0002-design-system.md)                                                       | aceita | vale; cores no ADR-008       |
| 003 | [Autenticação com Better Auth, Prisma 7 e 2FA](0003-autenticacao.md)                                                        | aceita | vale; HIBP no ADR-022        |
| 004 | [Modelo de dados, dinheiro e regras no banco](0004-modelo-de-dados.md)                                                      | aceita | vale; zerar no ADR-024       |
| 005 | [Hospedagem, deploy e operação](0005-hospedagem-e-deploy.md)                                                                | aceita | vale; CSP no ADR-020         |
| 006 | [Lar, carteiras e autorização por recurso](0006-autorizacao-por-recurso.md)                                                 | aceita | vale                         |
| 007 | [Lançamentos, contas e categorização preparada para IA](0007-lancamentos-e-categorizacao.md)                                | aceita | vale; LLM no ADR-016         |
| 008 | [Visual "Elétrico" com vidro só na moldura](0008-visual-eletrico.md)                                                        | aceita | vale                         |
| 009 | ["Pago por", ambientes, parcelas e despesas fixas](0009-pago-por-parcelas-e-fixas.md)                                       | aceita | vale                         |
| 010 | [Orçamento, painel e cache das somas](0010-orcamento-e-painel.md)                                                           | aceita | vale                         |
| 011 | [Coleta bancária com o Meu Pluggy](0011-coleta-bancaria.md)                                                                 | aceita | vale                         |
| 012 | [Revisão e reconciliação do que vem do banco](0012-revisao-e-reconciliacao.md)                                              | aceita | vale                         |
| 013 | [Importar extrato OFX](0013-importar-extrato.md)                                                                            | aceita | vale                         |
| 014 | [Fatura do cartão em PDF e o serviço Python](0014-fatura-em-pdf.md)                                                         | aceita | vale                         |
| 015 | [Categorização inteligente: a categoria do banco e o classificador](0015-categorizacao-inteligente.md)                      | aceita | vale                         |
| 016 | [LLM local: o Qwen2.5 3B, com defesa em camadas](0016-llm-local.md)                                                         | aceita | vale                         |
| 017 | [O resumo do mês: três observações por regras, sem IA](0017-resumo-do-mes.md)                                               | aceita | vale                         |
| 018 | [O bot de lançamento pelo WhatsApp](0018-bot-whatsapp.md)                                                                   | aceita | vale                         |
| 019 | [O Telegram como segundo canal do bot](0019-bot-telegram.md)                                                                | aceita | vale                         |
| 020 | [Segurança contínua: OWASP Top 10:2025, ZAP e OSV no CI](0020-seguranca-continua.md)                                        | aceita | vale                         |
| 021 | [E2E em escala: o build de produção em 3 partes no CI](0021-e2e-em-escala.md)                                               | aceita | vale                         |
| 022 | [A Ajuda no app e o HIBP com tempo limite](0022-ajuda-no-app.md)                                                            | aceita | vale                         |
| 023 | [A arquitetura documentada a partir do código: o mapa do fluxo, o C4 e o site](0023-arquitetura-documentada.md)             | aceita | nova (M12.3b)                |
| 024 | [A preparação para os dados reais: zerar, backup de ponta a ponta, alerta e ZAP ativo](0024-preparacao-para-dados-reais.md) | aceita | nova (M12.4a); adendo M12.4b |

## Revisão de 28/10/2026 (M12.3b)

Antes da v1.0.0, cada ADR foi lido de novo contra o código. O que mudou ficou no fim de cada um,
na seção "Revisão do M12.3b", e o resumo na última coluna da tabela acima: **vale** (continua
valendo como está) ou **vale; X no ADR-N** (uma parte foi substituída por uma decisão posterior,
que o ADR aponta). Nenhum ADR foi substituído por inteiro.

O que ficou em aberto nos ADRs e no documento do OWASP está numa lista só, com a prioridade, no
[relatório de arquitetura](../arquitetura/relatorio.md#pendências-consolidadas).
