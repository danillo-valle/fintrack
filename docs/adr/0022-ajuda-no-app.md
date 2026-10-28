# ADR-022: A Ajuda no app, as telas de contas em modal e o tempo limite das senhas vazadas

- Status: aceita
- Data: 2026-10-27
- Módulo: M12.3a

## Contexto

O roteiro do M12 pedia um manual do usuário completo dentro do app: no menu, no "?" de cada tela,
com busca, desenhado no canvas antes do código. No uso de verdade, a Nelcimara esbarrou em duas
telas de Contas e cartões: o aviso "Conta criada." aparecia no pé da página, fora da vista, e ela
criou a mesma conta várias vezes; o cadastro do cartão era um `<details>` "Novo cartão em …" que
ela não achou. E o M12.2 mostrou que a consulta de senhas vazadas (Have I Been Pwned) esperava a
internet sem tempo limite: no cadastro, na troca e na redefinição de senha, um serviço lento
deixava a pessoa parada.

## Decisão

Decidido pelo Danillo em 27/10/2026 (as recomendações), com o canvas linha J aprovado no mesmo dia:

1. **A Ajuda só para quem entrou, com uma parte pública.** `/ajuda` (índice por 7 tópicos e a
   busca) e `/ajuda/[slug]` (um artigo) pedem sessão. A página `/primeiro-acesso` é pública: o passo
   a passo de criar a conta, confirmar o e-mail e ligar o 2FA, ligada de Entrar e de Criar conta.
2. **O conteúdo é código, não banco.** Os artigos ficam em `apps/web/src/features/help/content.ts`
   (texto puro com `**negrito**`, sem HTML), versionados e revisados como o resto. O mesmo artigo
   serve à página, ao modal e à busca.
3. **Toda tela aponta para um artigo, conferido pelo tipo.** O `PageHeader` ganhou `help`,
   obrigatório: um `HelpSlug` (a união dos endereços dos artigos) ou `null` nas telas que não têm um
   (a própria Ajuda, o catálogo de desenvolvimento, Ajustes, que lista a Ajuda). Tela nova sem
   `help` não compila. O "?" ao lado do título abre o artigo em modal (`@modal/(.)ajuda/[slug]`);
   aberto direto, é a página inteira.
4. **A busca é no servidor, por GET.** `?q=` (até 60 caracteres), sem acento e sem diferença de
   maiúsculas, todas as palavras; o trecho marca a palavra como está escrita. Funciona antes do
   React e o endereço guarda o que se buscou.
5. **Contas e cartões em modal, com o aviso no topo.** "Nova conta" vai para o cabeçalho e
   "Adicionar cartão" aparece em toda conta de cartão ou de vale; os dois abrem em modal
   (`/ajustes/contas/nova` e `/ajustes/contas/[accountId]/cartao`, também como página inteira).
   Dando certo, a action volta para a lista (`?criada=` ou `?cartao=`): o aviso vem em cima e a
   conta nova fica marcada.
6. **Senhas vazadas com tempo limite de 3 s, recusando sem resposta.** O plugin `haveIBeenPwned`
   do Better Auth deu lugar a `apps/web/src/lib/auth/leaked-password.ts`: a mesma consulta
   (k-anonimato, 5 caracteres do SHA-1, `Add-Padding`), com `AbortSignal.timeout(3000)`. Sem
   resposta, erro de rede ou resposta estranha: a senha é recusada com o código
   `PASSWORD_CHECK_UNAVAILABLE` ("tente de novo em alguns segundos") e o log registra só o evento
   `auth.password_check_unavailable`. A regra do ADR-003 não muda: senha nova só passa conferida.

## Consequências

- Mudou uma tela? O artigo dela muda no mesmo PR (regra no CLAUDE.md e na skill `ui-componentes`).
- O E2E abre todo artigo (título na aba e o `<h1>`), testa o "?" em modal e na página inteira, a
  busca e a página pública; o axe passa pelo índice, por um artigo, pela busca e pelo primeiro
  acesso (`PAGES`/`PUBLIC_PAGES`), e a trava do M12.2 cobre as rotas novas.
- O `StepFooter` saiu de `features/bank` para `components/feedback`: agora é usado por bank e accounts.
- O SHA-1 do HIBP passou a estar no nosso código, e o CodeQL o marca como hash fraco de senha
  (`js/insufficient-password-hash`). É o protocolo, não o jeito de guardar: o alerta foi dispensado
  como falso positivo, com o motivo no OWASP (A04, "Exceções do CodeQL"); o teste usa o exemplo
  publicado do HIBP com o hash escrito à mão e não calcula SHA-1 de senha.
- Com o HIBP fora do ar, ninguém cria conta nem troca a senha até ele voltar (escolha consciente:
  deixar passar sem conferir abriria a porta para uma senha vazada).

## Alternativas consideradas

- **Ajuda toda pública.** Descartada: o manual descreve o app por dentro e só interessa a quem foi
  convidado.
- **Conteúdo em Markdown/MDX.** Descartado agora: mais uma dependência e um passo de build para
  ~25 artigos curtos; o texto puro com negrito cobre o que o manual precisa.
- **Busca no navegador.** Descartada: o servidor responde a mesma coisa sem depender do React, e o
  índice é pequeno.
- **HIBP: deixar passar quando não responde.** Descartada pelo Danillo: uma senha vazada poderia
  entrar exatamente quando o serviço estivesse fora.
