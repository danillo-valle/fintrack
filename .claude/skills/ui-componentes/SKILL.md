---
name: ui-componentes
description: Regras para componentes e telas do FinTrack. Use ao criar ou revisar componentes, páginas, avisos ou formulários em apps/web.
---

# Componentes e telas do FinTrack

## Acessibilidade

Regras aprendidas nas explorações por teclado do M02.

- **Foco nunca escondido.** O cabeçalho, a barra inferior e o botão "+" são fixos no celular. O `scroll-padding-top` e o `scroll-padding-bottom` do `html` (`globals.css`) mantêm o elemento focado fora deles. Ao mudar a altura ou a posição de um desses elementos, ajuste o `scroll-padding`. O `e2e/foco-visivel.spec.ts` verifica isso.
- **Aviso com ação** ("Desfazer") dura pelo menos 10 s e informa o atalho Alt+T na descrição. Use `undoToastOptions` (`components/feedback/undo-toast.ts`).
- **Foco depois de excluir:** vai para o próximo item da lista, ou para o título da seção se a lista ficar vazia. Depois de desfazer, volta ao item restaurado.
- **Formulário com erro:** ao enviar, o foco vai para o primeiro campo inválido. O erro do campo some assim que ele é corrigido.
- **Indicador de foco** com contraste mínimo de 3:1 contra a cor vizinha, nos dois temas. Vale também para componentes de terceiros (Sonner, por exemplo), cujo CSS pode exigir `!` para ganhar das classes do Tailwind.
- **Tela nova** entra na lista `PAGES` do `e2e/foco-visivel.spec.ts`.
