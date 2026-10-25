# O FinTrack e o OWASP Top 10:2025

Revisão item por item feita no M12.1 (outubro de 2026, versão 0.12.2), com a prova de cada
proteção no próprio repositório: o arquivo que faz e o teste que confere. A decisão sobre como a
segurança passa a ser vigiada a cada PR está no [ADR-020](../adr/0020-seguranca-continua.md).

O [OWASP Top 10:2025](https://owasp.org/Top10/2025/) é a lista dos dez riscos mais comuns em
aplicações web. A edição de 2025 trouxe dois itens novos: **A03 Falhas na cadeia de
suprimentos** (as dependências e o caminho até a produção) e **A10 Tratamento incorreto de
condições excepcionais** (o que o sistema faz quando algo dá errado).

## Como isto fica em dia

Este documento é a fotografia da revisão. O que segura a fotografia no lugar, a cada pull request:

- **ZAP** (`scripts/zap/`): varredura passiva da imagem de produção no job `imagem` do CI, sem
  sessão e com uma conta de teste criada pelo caminho de verdade (cadastro, e-mail, 2FA). Barra o
  PR com alerta de risco Baixo ou maior. Detalhes em [A ferramenta ZAP](#a-ferramenta-zap).
- **OSV-Scanner** (`osv-scanner.toml`): os dois lockfiles (`pnpm-lock.yaml` e
  `services/ml/uv.lock`) contra a base pública de vulnerabilidades, no job `seguranca`. Barra o PR
  com qualquer vulnerabilidade conhecida.
- **gitleaks**, **CodeQL** e o **Dependabot** (npm, ações do GitHub, Python e as imagens dos
  compose), que já existiam.
- Os testes citados abaixo, que rodam no CI como todos os outros.

Funcionalidade nova que mexer num destes itens atualiza a linha dele aqui, no mesmo PR (skill
`seguranca`).

## Resumo

| Item                                       | Situação                      | O que o M12.1 mudou                                                 |
| ------------------------------------------ | ----------------------------- | ------------------------------------------------------------------- |
| A01 Controle de acesso quebrado            | Coberto                       | Teste de CSRF nas duas portas (API do login e Server Actions)       |
| A02 Configuração de segurança incorreta    | Coberto                       | CSP: `<style>` só com nonce ou hash; o ZAP confere a imagem         |
| A03 Falhas na cadeia de suprimentos        | Coberto, com 1 pendência      | OSV no CI, 76 alertas corrigidos, ações presas pelo commit          |
| A04 Falhas de criptografia                 | Coberto                       | Teste dos atributos do cookie da sessão, inclusive em HTTPS         |
| A05 Injeção                                | Coberto                       | Trava do ESLint para SQL montado com texto                          |
| A06 Design inseguro                        | Coberto, com 1 risco residual | O bot diz o que falta em vez de uma frase genérica                  |
| A07 Falhas de autenticação                 | Coberto, com 1 pendência      | Tentativas recusadas no log                                         |
| A08 Falhas de integridade de software/dado | Coberto, com 1 pendência      | Ações do CI presas pelo commit                                      |
| A09 Falhas de registro e alerta            | Coberto, com 1 pendência      | Eventos `auth.*` e a seção "Segurança" no `fintrack-status`         |
| A10 Condições excepcionais                 | Coberto                       | Tela de erro com o código do log; erro próprio nas telas de entrada |

As pendências (o que é grande demais para o módulo) estão juntas no fim, com o risco e a sugestão.

---

## A01 Controle de acesso quebrado

**O risco.** Alguém vê ou altera o que não é seu: trocar o id na URL (IDOR), chegar a uma tela
sem login, fazer o navegador de outra pessoa executar uma ação (CSRF), ou fazer o servidor buscar
um endereço escolhido pelo atacante (SSRF, que entrou neste item em 2021).

**Como o FinTrack se protege.**

- **Um crachá para tudo** (ADR-006): toda operação que lê ou grava uma carteira, o lar, uma conta
  ou um lançamento exige um crachá tipado (`WalletGrant`, `HouseholdGrant`, `AccountGrant`,
  `TransactionGrant`), que só as funções de `packages/db/src/access.ts` emitem, depois de
  consultar o vínculo da pessoa no banco. A matriz de papéis é pura e testada com uma tabela
  escrita à mão (`packages/core/src/access.ts`). Sem crachá, o código não compila.
- **Recurso de outra pessoa responde 404**, igual a um que não existe, para não confirmar que ele
  existe (`apps/web/src/lib/access.ts`, `notFoundOnDenied`).
- **Toda página de `(app)` e toda Server Action começa com `requireUser()`**; o teste
  `apps/web/src/app/paginas-protegidas.test.ts` lê os arquivos e falha se uma não começar. O
  `proxy.ts` só redireciona quem não tem cookie (conveniência, não barreira).
- **Rotas públicas pelo caminho exato**: `apps/web/src/lib/auth/routes.ts` (`PUBLIC_ENDPOINTS`
  lista os dois webhooks; nunca um prefixo).
- **Destino depois do login só interno** (`safeNextPath`: nada de `//site`, `\`, controle ou outra
  origem), contra o redirecionamento aberto.
- **Acesso ao banco só nas camadas que checam permissão**: o ESLint do app proíbe importar o
  `@fintrack/db` fora de `features/*/server` e `lib/`.
- **CSRF**: o Better Auth recusa pedido sem `Origin` ou de outra origem (`trustedOrigins`); o
  Next.js aborta a Server Action cuja `Origin` não é o próprio endereço; o cookie da sessão é
  `SameSite=Lax`.
- **O que fica no navegador depois de sair** (M12.2, `partialPrefetching`): o Next.js busca de
  antemão a "casca" de cada tela e a guarda na memória da aba, por sessão (as telas leem o cookie).
  O Sair recarrega a página inteira, o que apaga essa memória; o teste "sair apaga a sessão e fecha
  o app" (`e2e/autenticacao.spec.ts`), que agora roda contra o build de produção em todo PR
  (ADR-021), prova que depois de sair a tela volta a pedir o login.
- **SSRF**: o servidor só chama endereços que vêm da configuração (`PLUGGY_API_URL`,
  `ML_SERVICE_URL`, `WHATSAPP_API_URL`, `TELEGRAM_API_URL`), conferidos por `normalizeBaseUrl`
  (`packages/importers/src/pluggy`); nenhum endereço vem do que a pessoa digita. O serviço Python
  fica numa rede interna sem saída para a internet e só aceita o token curto do app.
- **Webhooks**: a assinatura da Meta (HMAC sobre o corpo cru) e o segredo do Telegram são
  conferidos em tempo constante antes de ler o JSON (`lib/whatsapp/protocol.ts`,
  `lib/telegram/protocol.ts`); a resposta é a mesma para tudo, e nada é gravado sem a conferência.

**Provas.** `apps/web/e2e/permissoes.spec.ts` (IDOR com duas pessoas, 404 idêntico);
`packages/db/src/permissoes-doc.test.ts` (o `docs/permissoes.md` bate com a matriz);
`apps/web/e2e/cabecalhos.spec.ts`, bloco "pedido de outra origem é recusado" (**novo no M12.1**:
o mesmo pedido de uma Server Action é recusado com outra origem e grava com a origem do app; a
API do login responde `INVALID_ORIGIN` e `MISSING_OR_NULL_ORIGIN`); os testes dos webhooks em
`bot-whatsapp.spec.ts` e `bot-telegram.spec.ts` (assinatura e segredo errados não gravam nada).

## A02 Configuração de segurança incorreta

**O risco.** Padrões inseguros: cabeçalhos ausentes, páginas de depuração no ar, mensagens de erro
detalhadas, portas abertas, permissões largas.

**Como o FinTrack se protege.**

- **Cabeçalhos** (`apps/web/src/lib/security-headers.ts`): CSP com nonce sorteado a cada pedido
  (`script-src` com `'strict-dynamic'`, sem `unsafe-inline` e, em produção, sem `unsafe-eval`),
  `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`,
  `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`,
  `Cross-Origin-Opener-Policy`; sem `X-Powered-By`. HSTS de 1 ano e sem `Server`/`Via` no Caddy.
- **Estilo (novo no M12.1)**: a CSP separa `<style>` de `style="..."`. Um `<style>` só entra com o
  nonce ou pelo hash exato do CSS do sonner (`INLINE_STYLE_HASHES`); o atributo `style=` continua
  liberado (largura das barras, cores por variável), porque atributo não tem seletor e não lê nada
  da página. Antes, `'unsafe-inline'` valia para os dois (ADR-005); o ZAP acusava (regra 10055).
- **Containers endurecidos** (`deploy/compose.prod.yml`): somente leitura, sem capacidades de root,
  `no-new-privileges`, limite de memória, nenhuma porta publicada (a entrada é o túnel da
  Cloudflare), banco e serviço Python em redes internas.
- **O que é só de desenvolvimento não vai para produção**: o catálogo `/dev/ui`, o `unsafe-eval` e
  o `<style>` liberado da CSP.
- **Variáveis conferidas na partida** (`apps/web/src/lib/env.ts`): faltou ou está fora do formato,
  o app não sobe.

**Provas.** `apps/web/src/lib/security-headers.test.ts` (a CSP de produção e a de dev; o hash do
sonner é calculado do pacote instalado: atualizar o sonner sem trocar o hash falha o teste);
`apps/web/e2e/cabecalhos.spec.ts` (cada página manda a CSP; nenhuma tela dispara violação; HTML e
`<style>` injetados não rodam); o **ZAP** contra a imagem a cada PR.

## A03 Falhas na cadeia de suprimentos de software

**O risco** (novo em 2025). Uma dependência com vulnerabilidade conhecida, um pacote malicioso
publicado no npm, uma ação do GitHub trocada, uma imagem adulterada.

**Como o FinTrack se protege.**

- **Lockfiles e instalação exata**: `pnpm install --frozen-lockfile` e `uv sync --frozen` no CI e
  nas imagens.
- **Idade mínima de 1 dia** para pacote do npm (`minimumReleaseAge` no `pnpm-workspace.yaml`,
  explícito desde o M12.1) e **scripts de instalação desligados** por padrão (só os listados em
  `allowBuilds` rodam).
- **OSV-Scanner no CI (novo no M12.1)**: os dois lockfiles contra a base OSV; qualquer
  vulnerabilidade conhecida barra o PR, e uma falha da própria consulta também (nunca passa
  calado). Exceção só no `osv-scanner.toml`, presa ao pacote e à versão, com motivo e prazo.
- **Ações do GitHub presas pelo commit (novo no M12.1)**: `uses: dono/acao@<sha> # vX.Y.Z`. Uma
  etiqueta pode ser movida por quem controla o repositório da ação; o commit, não.
- **Dependabot**: npm, ações do GitHub e, desde o M12.1, o serviço Python (`uv`) e as imagens dos
  compose (Postgres, Caddy, cloudflared, Mailpit).
- **gitleaks** em todo o histórico e **CodeQL** em todo PR.

**O que a revisão achou e corrigiu.** Ao preparar o OSV-Scanner, a base mostrou o que já estava no
ar e ninguém tinha visto:

| Onde                        | O quê                                                                                         | Correção                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Next.js 16.3.8 (produção)   | 2 críticos e 1 alto, publicados em 22/10 (o alto, DoS por Server Actions, afetava o FinTrack) | Next.js 16.4.3, num patch antes do M12.1                                                             |
| 29 alertas do npm           | nodemailer, zod, vite/vitest, Prisma CLI (mysql2, deepmerge-ts), shadcn                       | `pnpm update` só desses pacotes, dentro das faixas; Prisma 7.10.1; shadcn foi para `devDependencies` |
| mysql2 3.15.3               | peer opcional do Better Auth preso no lockfile                                                | `overrides` com o motivo (pnpm-workspace.yaml)                                                       |
| Pillow 12.3.0 (imagem `ml`) | 37 alertas; o Pillow lê o PDF que a pessoa envia                                              | Pillow 13.0.0 (pytest e eval iguais)                                                                 |
| pypdf 6.20.1                | 7 alertas (só nos testes)                                                                     | pypdf 6.21.2                                                                                         |

**Provas.** O passo do OSV-Scanner no job `seguranca`; o `pnpm audit` e o `pip-audit` limpos no
laboratório (a base OSV junta os mesmos alertas).

**Pendência.** As imagens-base do Dockerfile (`node`, `python`, `uv`) são etiquetas que andam (a
linha 24, a 3.13), sem digest; o Dependabot não as lê, porque o `FROM` usa `${NODE_VERSION}`.
Veja [Pendências](#pendências).

## A04 Falhas de criptografia

**O risco.** Dado sensível sem proteção em trânsito ou guardado, segredo fraco ou no lugar errado.

**Como o FinTrack se protege.**

- **HTTPS** de ponta a ponta até a Cloudflare; HSTS de 1 ano; `upgrade-insecure-requests` na CSP.
- **Senhas** com o hash do Better Auth (scrypt), nunca guardadas nem logadas; política do NIST
  (mínimo 8, frases longas, senhas vazadas recusadas).
- **Segredos guardados cifrados**: o Client Secret do Meu Pluggy com AES-256-GCM, a versão da
  chave no primeiro byte e o id da conexão como dado associado
  (`packages/db/src/connection-secret.ts`); rotação pela chave nova na frente.
- **Só o hash do que identifica**: número do WhatsApp e conversa do Telegram como HMAC; código de
  vínculo e convite como SHA-256; o texto da mensagem do bot cifrado e apagado ao ler.
- **Token curto entre o app e o serviço Python**: JWT EdDSA de 2 minutos, assinado só no servidor
  (`apps/web/src/lib/auth/ml-token.ts`), conferido pela chave pública (`services/ml/app/auth.py`).
- **Backups cifrados com age** antes de sair do servidor (`deploy/bin/fintrack-backup`); o servidor
  só tem a chave pública.
- **Segredos só no `/srv/fintrack/*.env`** (modo 600, gravados pelo `fintrack-definir`, valor
  escondido), nunca no Git, em log ou no navegador.
- **Cookie da sessão**: `HttpOnly`, `SameSite=Lax`, e em HTTPS `Secure` com o prefixo `__Secure-`.

**Provas.** `packages/db/src/integration/coleta-bancaria.integration.test.ts` (o segredo cifrado, a chave errada e a rotação); `apps/web/src/lib/auth/cookies.test.ts`
(**novo no M12.1**: os atributos do cookie com as opções de verdade do `auth.ts`, em HTTP e em
HTTPS); `apps/web/e2e/cabecalhos.spec.ts`, bloco "cookie da sessão" (o `Set-Cookie` real do
login).

## A05 Injeção

**O risco.** Dado do usuário interpretado como comando: SQL, HTML/JavaScript (XSS), fórmula de
planilha, instrução para um modelo de linguagem.

**Como o FinTrack se protege.**

- **SQL só parametrizado**: o Prisma, e nos poucos SQL à mão, `$queryRaw` com template ou
  `Prisma.sql`. **Novo no M12.1**: o ESLint recusa `$queryRawUnsafe`, `$executeRawUnsafe` e
  `Prisma.raw` em todo o monorepo (`RAW_SQL_RESTRICTIONS`, `packages/config/eslint.mjs`).
- **HTML**: o React escapa todo texto; nenhum `dangerouslySetInnerHTML`; os e-mails escapam o que
  vem da pessoa (`apps/web/src/lib/email-templates.ts`); a CSP com nonce é a segunda camada.
- **CSV**: descrição que começa com `=`, `+`, `-`, `@`, tabulação ou retorno ganha um apóstrofo na
  exportação (`packages/core/src/csv.ts`).
- **Arquivos**: OFX lido na memória com limite de 2 MB e PDF de 5 MB e 30 páginas, leitores sem
  avaliação de nada do arquivo.
- **Bot**: leitor determinístico (`packages/core/src/bot-parse.ts`), nenhum LLM no caminho; a
  mensagem é dado, nunca instrução.
- **IA local da categorização** (ADR-016): filtro de texto com cara de instrução antes do modelo,
  resposta presa por schema, nada aplicado sem a confirmação da pessoa. O risco aceito está no
  adendo do ADR-016.

**Provas.** `packages/core/src/csv.test.ts`; `apps/web/e2e/cabecalhos.spec.ts` (HTML e `<style>`
injetados não rodam); o lint do CI (a trava do SQL); os testes do leitor do bot.

## A06 Design inseguro

**O risco.** A falha está no desenho, não no código: faltou um limite, uma confirmação, um fluxo
pensado para o abuso.

**Como o FinTrack se protege.** Cada módulo começa por um ADR que diz o que pode dar errado. Alguns
exemplos do desenho: lançamento do bot nasce rascunho e só vale no Confirmar; ações sensíveis
(passkey, 2FA, exportar) pedem identidade de novo nos últimos 10 minutos; cadastro fechado por
lista e com resposta igual para e-mail fora dela; limites de tentativas no login, no 2FA e no
código de vínculo; respostas grátis do WhatsApp contadas com folga para nunca gerar cobrança;
dados do banco entram como recebidos e ficam fora das somas até a revisão.

**Novo no M12.1.** O bot dizia "escolha os padrões" para qualquer falta, inclusive para quem não
tinha o que escolher (caso real na produção em 24/10). Agora cada motivo tem a sua frase
(`missingChoiceMessage`) e o Confirmar que perdeu o acesso no meio diz isso
(`CONFIRM_NOT_ALLOWED_MESSAGE`). Provado em `packages/db/src/integration/bot.integration.test.ts`.

**Risco residual (consciente).** O limite do código de vínculo é por remetente: 5 erros em uma
hora bloqueiam aquela conta por 24 h. No Telegram, quem criar muitas contas tenta mais. O código
tem 1 milhão de valores, vale 10 minutos e só existe enquanto alguém está vinculando; com 5
tentativas por conta por hora, a chance de acertar um código ativo é de 5 em 1 milhão por conta.
Veja [Pendências](#pendências) para o limite por código.

## A07 Falhas de autenticação

**O risco.** Senha adivinhada, sessão roubada ou longa demais, recuperação de conta fraca.

**Como o FinTrack se protege** (ADR-003, `apps/web/src/lib/auth.ts`): 2FA por app autenticador
obrigatório para todas as contas; passkeys; senhas vazadas recusadas; limite de tentativas no
banco por endpoint (entrar 5/min, 2FA 5/min, cadastro e recuperação 3/min, trocar senha 5/min);
e-mail confirmado antes de entrar; troca de senha derruba as outras sessões e avisa por e-mail;
link de recuperação de 1 hora e uso único; sessão de 7 dias sem uso; reautenticação de 10
minutos para o que é sensível; Google só entra numa conta que já existe.

**Novo no M12.1.** As tentativas recusadas passam a ficar no log (veja A09).

**Pendência.** Não há aviso por e-mail de "novo acesso" num aparelho novo.

## A08 Falhas de integridade de software e de dados

**O risco.** Código ou dado aceito sem conferir de onde veio: atualização sem assinatura, CI
comprometido, desserialização de dado de fora.

**Como o FinTrack se protege.** A `main` só recebe código por PR com os quatro jobs obrigatórios;
as imagens são construídas pelo CI a partir do commit e etiquetadas com ele, e o servidor confere
que o app no ar responde com o commit novo antes de concluir o deploy (ADR-005); migrações só
aditivas e aplicadas pela imagem do mesmo commit; o que chega de fora é JSON validado (zod,
pydantic), nunca objeto desserializado; os modelos do classificador só são lidos do volume da
produção, pelo id da carteira conferido. **Novo no M12.1**: as ações do CI presas pelo commit.

**Pendência.** O servidor confia na etiqueta `:main` do GHCR; não confere uma assinatura nem a
proveniência da imagem.

## A09 Falhas de registro e alerta de segurança

**O risco.** O ataque acontece e ninguém fica sabendo, ou o log não ajuda a entender.

**Como o FinTrack se protege.**

- **Log JSON com `event` estável** (`apps/web/src/lib/logger.ts`), com senha, token, cookie e
  segredos apagados por lista, e-mail mascarado e nenhum texto de lançamento ou mensagem.
- **Auditoria** em tabela que só aceita acréscimo (gatilho `audit_log_append_only`), na mesma
  transação de cada ação (`packages/db/src/audit.ts`).
- **Eventos de segurança**: `access.denied` (tentativa de abrir recurso de outra pessoa),
  `webhook.rejected` (assinatura ou segredo errado), `request.error` (erro não tratado, com o
  código que a tela mostra). **Novos no M12.1** (`apps/web/src/lib/auth/security-log.ts`):
  `auth.failed` (senha, código do 2FA, código de backup, passkey ou link recusados),
  `auth.rate_limited` (o limite barrou) e `auth.origin_rejected` (outra origem), com o caminho, o
  status, o código e o IP, nunca o corpo do pedido.
- **`sudo -u fintrack fintrack-status`** mostra a contagem das últimas 24 h (novo); o runbook diz
  o que cada uma significa e quando agir.
- **Disponibilidade**: UptimeRobot no `/api/health` e Healthchecks.io no backup e no deploy.

**Provas.** `apps/web/src/lib/logger.test.ts` (o que é apagado);
`apps/web/src/lib/auth/security-log.test.ts` (cada evento, e que nem e-mail nem senha vão para o
log).

**Pendência.** Os eventos de segurança não disparam alerta sozinhos: é preciso olhar o
`fintrack-status`.

## A10 Tratamento incorreto de condições excepcionais

**O risco** (novo em 2025). Erro que abre a porta (falha aberta), que vaza detalhes, ou que deixa o
sistema num estado pela metade.

**Como o FinTrack se protege.**

- **Falha fechada**: qualquer dúvida no crachá vira 404; id fora do formato nem vai ao banco;
  webhook com qualquer problema responde "ok" sem gravar; o OSV e o ZAP saem com erro quando a
  própria ferramenta falha.
- **Nada pela metade**: operações de dinheiro em transação; o bot reserva a mensagem antes de
  qualquer efeito (uma vez só, mesmo com a fila repetindo); o Confirmar fecha o rascunho primeiro e
  reabre se o lançamento falhar; deploy volta a versão anterior se a nova não responder.
- **Erro sem detalhe para quem vê, com detalhe no log**: a tela mostra uma mensagem simples; o
  `instrumentation.ts` grava o erro com o caminho (sem query, que pode ter token) e o `digest`.
- **Novo no M12.1**: a tela de erro mostra o código (o mesmo `digest` do log), e as telas de entrada
  ganharam a tela de erro própria (antes caíam na página genérica do Next.js). Desenho na linha I
  do canvas.
- **Provas**: `apps/web/e2e/catalogo.spec.ts` (a caixa mostra e copia o código);
  conferido no laboratório com uma página que lança um erro de propósito, no app e nas telas de
  entrada, contra o build de produção: o código na tela é o `digest` do log, e a mensagem do erro
  não aparece na página.
- Na varredura logada do ZAP (cerca de 8 mil pedidos, inclusive com filtros em combinações que
  ninguém digitaria), o servidor não registrou nenhum erro.

---

## A ferramenta ZAP

O [ZAP](https://www.zaproxy.org/) (Zed Attack Proxy, da OWASP) navega pelo app e examina cada
resposta. No FinTrack ele roda **só no modo passivo**: segue links e formulários GET, nunca envia
um POST, nunca tenta atacar. Assim ele pode rodar a cada PR contra um banco limpo sem risco e sem
falso alarme de teste agressivo.

- `scripts/zap/plano.yaml`: o plano (Automation Framework do ZAP), as exceções e o critério.
- `scripts/zap/varrer.sh`: roda o plano (ZAP da imagem oficial, versão fixa) e resume os alertas.
- `scripts/zap/conta-de-teste.mjs`: cria a conta de teste pelo caminho de verdade e entrega só o
  cabeçalho `Cookie` (por variável de ambiente; nunca na linha de comando nem no log).

**Duas rodadas no CI**, depois do teste de fumaça da imagem: `publico` (telas de entrada, webhooks,
arquivos públicos) e `logado` (com o seed sintético da "Família Exemplo"). Relatórios HTML e JSON
ficam como artefato do job por 14 dias (`relatorios-zap`).

**O critério**: alerta de risco Baixo ou maior barra o PR. Informativo sai no relatório e não
barra.

**Exceções em vigor** (cada uma no plano, com o motivo):

| Regra | Nome                        | Por que não se aplica                                                                                                        |
| ----- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 10202 | Absence of Anti-CSRF Tokens | A proteção é a conferência da origem (Better Auth e Next.js) e o cookie `SameSite=Lax`, provada no E2E com a mutação inversa |

**Informativos que aparecem e por que ficam** (não barram): 10027 "Suspicious Comments" (palavras
como "query" e "user" no JavaScript minificado do Next.js); 10109 "Modern Web Application"; 10019
"Content-Type Header Missing" (respostas de redirecionamento, sem corpo); 10031 "User
Controllable HTML Element Attribute" (os filtros da lista voltam nos links; o React escapa, e o
`volta=` só aceita uma lista fixa de telas, com teste).

## Pendências

Grandes demais para o M12.1, ou que pedem uma decisão. Cada uma com o risco e uma sugestão.

| #   | Item | O quê                                                                             | Risco         | Sugestão                                                                                                                                     |
| --- | ---- | --------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A09  | Eventos de segurança sem alerta automático                                        | Médio         | Um timer de hora em hora no servidor que conta `auth.failed` e `auth.rate_limited` e avisa o Healthchecks acima de um limite                 |
| 2   | A08  | A imagem do GHCR não é assinada; o servidor não confere a proveniência            | Baixo a médio | `actions/attest-build-provenance` no CI e `gh attestation verify` no `fintrack-deploy` antes de trocar a versão                              |
| 3   | A03  | Imagens-base do Dockerfile por etiqueta, sem digest, fora do Dependabot           | Baixo         | Digest no `FROM` com o Renovate (que lê `ARG`), junto da pendência Dependabot × Renovate; até lá, cada build pega o patch mais novo da linha |
| 4   | A07  | Sem e-mail de "novo acesso" em aparelho novo                                      | Baixo         | Gancho `after` no 2FA confirmado, comparando o aparelho com as sessões anteriores                                                            |
| 5   | A06  | Limite do código de vínculo por remetente (várias contas no Telegram tentam mais) | Baixo         | Matar o código ativo do lar depois de N erros de quaisquer remetentes (com o cuidado de não virar um jeito de impedir o vínculo legítimo)    |
| 6   | —    | ZAP só passivo                                                                    | Decisão       | Uma varredura ativa (ataque de verdade) só contra uma cópia local, fora do CI, antes do v1.0.0                                               |
