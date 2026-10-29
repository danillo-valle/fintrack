# ADR-020: Segurança contínua: OWASP Top 10:2025, ZAP e OSV no CI

- Status: aceita
- Data: 2026-10-24
- Módulo: M12.1 (desenho da linha I do canvas para as telas)

## Contexto

Até o M12.0b, a segurança do FinTrack estava espalhada nos ADRs de cada módulo (autenticação no
ADR-003, cabeçalhos e deploy no ADR-005, crachás no ADR-006, webhooks no ADR-018 e no ADR-019) e
nos testes. Faltavam duas coisas: uma revisão de ponta a ponta contra uma lista reconhecida, e um
jeito de a revisão não envelhecer, com o CI conferindo a cada PR.

O roteiro do M12 pediu o OWASP Top 10:2025 item por item e o ZAP no CI contra a imagem. Ao montar
o CI, apareceu um terceiro motivo: a base de vulnerabilidades mostrou o Next.js da produção com
três alertas publicados dois dias antes (um deles, travar o servidor pelas Server Actions, afetava
o FinTrack) e mais 73 alertas em dependências do npm e do Python. Nada no projeto avisava disso
fora os PRs do Dependabot, que só olhava o npm e as ações.

## Decisão

Decidido pelo Danillo em 24/10/2026 (as recomendações):

1. **O ZAP olha as telas públicas e as logadas**, em modo **passivo** (examina as respostas, não
   ataca), contra a **imagem de produção** no job `imagem` do CI, depois do teste de fumaça. A
   conta da rodada logada é criada pelo caminho de verdade (cadastro, link do e-mail no Mailpit,
   2FA) por `scripts/zap/conta-de-teste.mjs`, sem tocar no banco por fora; os dados vêm do seed
   sintético, pela imagem das migrações. O cookie entra no ZAP só por variável de ambiente.
2. **O ZAP barra o PR** com alerta de risco Baixo ou maior. Alerta que não se aplica vai para a
   lista de exceções do plano (`scripts/zap/plano.yaml`, job `alertFilter`), sempre com o motivo
   e a prova; exceção nova é decisão de revisão, nunca atalho para o CI passar.
3. **Lacuna pequena se corrige no módulo, com teste; a grande vira pendência** no documento
   (`docs/seguranca/owasp-top10-2025.md`), com o risco e a sugestão.
4. **OSV-Scanner no CI** (job `seguranca`), nos dois lockfiles. Qualquer vulnerabilidade conhecida
   barra o PR; falha da própria consulta também. Exceção só no `osv-scanner.toml`, presa ao pacote
   e à versão exatos, com motivo e prazo (`effectiveUntil`).

Decisões de implementação que vieram da revisão:

5. **CSP de estilo separada** (substitui o compromisso do ADR-005). `style-src-elem`: só o próprio
   site, o nonce da resposta e o hash exato do CSS que o sonner injeta (`INLINE_STYLE_HASHES`,
   conferido por teste contra o pacote instalado). `style-src-attr 'unsafe-inline'`: o atributo
   `style=` continua liberado, porque não tem seletor (não lê a página) e o React escapa todo texto.
   `style-src 'self'` vale para navegador antigo (Safari antes do 15.4), em que o estilo inline não
   aplica. Em desenvolvimento, `<style>` fica liberado: o Next.js põe o CSS das telas assim no
   recarregamento rápido, como o `unsafe-eval` dos scripts. Risco aceito: injeção de atributo
   `style` (só desenho, sem leitura), que exigiria uma falha de HTML que a CSP e o React já fecham.
6. **Ações do GitHub presas pelo commit**, com a versão no comentário; o Dependabot propõe as novas.
7. **Dependabot também no Python e nas imagens dos compose**, com as exceções: Postgres de versão
   maior (pede dump e restauração), o llama.cpp (o digest medido no ADR-016) e as imagens do próprio
   FinTrack.
8. **Pacote do npm com menos de 1 dia não entra** (`minimumReleaseAge: 1440`, explícito no
   `pnpm-workspace.yaml`).
9. **SQL montado com texto é proibido pelo ESLint** (`$queryRawUnsafe`, `$executeRawUnsafe`,
   `Prisma.raw`), na mesma regra da trava de dinheiro (uma lista só, para uma não apagar a outra).
10. **As tentativas recusadas do login viram eventos** (`auth.failed`, `auth.rate_limited`,
    `auth.origin_rejected`), gravados na rota `/api/auth/[...all]` (o 429 do limite sai antes de
    qualquer gancho do Better Auth), com caminho, status, código e IP, nunca o corpo. O
    `fintrack-status` mostra a contagem das últimas 24 h.

## Consequências

- O job `imagem` leva cerca de 6 minutos a mais (o limite foi de 25 para 40); o `seguranca`,
  menos de um minuto.
- Uma CVE nova numa dependência já instalada barra o próximo PR, mesmo que o PR não tenha mexido
  nela. É de propósito: a correção entra antes de qualquer outra coisa.
- Atualizar o sonner pede trocar o hash da CSP; o teste de unidade mostra o valor novo.
- O ZAP passivo não acha falha de lógica nem tenta injeção. Isso continua com os testes de acesso
  (IDOR, crachás) e com a revisão de cada módulo. Uma varredura ativa, contra uma cópia local, fica
  como pendência.
- O documento do OWASP passa a ser atualizado no mesmo PR de toda funcionalidade que mexer num item
  (skill `seguranca`).

## Alternativas consideradas

- **O `zaproxy/action-baseline`**: não deixa passar o cabeçalho da sessão sem montar a
  configuração na linha de comando, e cria issues no repositório. O `varrer.sh` com a imagem
  oficial roda igual no CI e no servidor, com o mesmo plano.
- **A sessão de teste gravada direto no banco**: dependeria do formato interno do cookie do Better
  Auth e não provaria o caminho de verdade. O cadastro pelo app prova junto que o e-mail, o link e
  o 2FA funcionam na imagem.
- **O fluxo reutilizável do OSV-Scanner**: criaria um check novo para registrar na regra da `main`
  e pediria permissão de escrita em "security events"; o passo dentro do job `seguranca`, que a
  regra já exige, faz o mesmo com menos permissão.
- **Tirar `unsafe-inline` do atributo `style`**: quebraria as barras, as cores por variável e o
  posicionamento dos menus do Radix; o ganho seria pequeno diante do `<style>`, que é o vetor real.

## Revisão do M12.3b (28/10/2026)

**Continua valendo.** O OWASP item por item, o ZAP e o OSV barrando o PR.

- Desde o M12.2 há uma exceção do OSV (o `deepmerge` do CLI do shadcn, rever até 31/01/2027) e,
  desde o M12.3a, uma do CodeQL (o SHA-1 do HIBP), cada uma com o motivo e a prova no documento.
- As 6 pendências do documento do OWASP continuam lá, com o risco e a sugestão.
