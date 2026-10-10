"use client";

// Formulário que volta ao início quando a tela fica escondida depois de um envio (M08).
//
// Com o Cache Components, o Next guarda as últimas 3 telas escondidas (<Activity>) em vez de
// desmontá-las: ao voltar, o formulário estaria como foi deixado, com o aviso "Conta criada."
// de antes. Este hook avisa quem está em volta (que troca a `key` e monta o formulário de novo)
// quando a tela é escondida depois de um envio. Rascunho sem envio fica como está (é para isso
// que a preservação serve). Veja o guia "Preserving UI state" do Next 16.
//
// Por que trocar a `key` e não embrulhar a action: o <form action> precisa receber a Server Action
// do próprio useActionState. Embrulhada numa função do navegador, o HTML do servidor sai com
// action="javascript:throw…" e um clique antes do JavaScript carregar se perde (aprimoramento
// progressivo; o E2E `formularios.spec.ts` confere).
import { useLayoutEffect, useRef } from "react";

export function useRenewWhenHidden(submitted: boolean, renew: () => void) {
  const latest = useRef({ submitted, renew });
  useLayoutEffect(() => {
    latest.current = { submitted, renew };
  });
  // A limpeza do efeito roda quando o <Activity> esconde a tela (e ao desmontar de vez, quando o
  // aviso cai no vazio). No modo estrito do dev, a montagem dupla passa com `submitted` falso.
  useLayoutEffect(
    () => () => {
      if (latest.current.submitted) latest.current.renew();
    },
    [],
  );
}
