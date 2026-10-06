// Navegação depois de mudar o estado de login (entrar, confirmar o 2FA, terminar a configuração
// do 2FA, sair). Sempre COMPLETA: o navegador pede a página de novo ao servidor.
//
// Por que não router.replace/router.push do Next.js nesses momentos:
//   1. No build de produção, o Next.js pré-carrega as rotas dos links e guarda as respostas na
//      memória. Uma resposta guardada ANTES do login ("vá para /entrar") era reaproveitada DEPOIS
//      dele, e a tela entrava num laço /entrar ↔ /. O pnpm dev não pré-carrega, por isso o
//      defeito só apareceu no M05, ao rodar os testes contra a imagem de produção.
//   2. Ao sair, a navegação completa joga fora tudo o que estava guardado na memória da aba
//      (telas com dados financeiros), em vez de deixar para o "voltar" do navegador.
//
// Navegação comum dentro do app (links, filtros) continua com o router do Next.js: é mais rápida.

/** Troca de página recarregando tudo do servidor (sem reaproveitar nada guardado na aba). */
export function navigateAfterAuthChange(path: string): void {
  window.location.assign(path);
}
