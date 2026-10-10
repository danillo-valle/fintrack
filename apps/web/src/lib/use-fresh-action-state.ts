"use client";

// useActionState que volta ao início quando a tela fica escondida (M08, Cache Components).
//
// Com o Cache Components, o Next guarda as últimas 3 telas escondidas (<Activity>) em vez de
// desmontá-las: ao voltar, o formulário estaria como foi deixado, com o aviso "Conta criada."
// de antes. Depois de um envio, ao esconder a tela, este hook devolve o estado inicial e limpa o
// formulário. Rascunho sem envio fica como está (é para isso que a preservação serve).
// Veja o guia "Preserving UI state" do Next 16 ("Resetting stale status messages").
import { startTransition, useActionState, useLayoutEffect, useRef } from "react";

const RESET = Symbol("reset");

export function useFreshActionState<S, P>(
  action: (prev: Awaited<S>, payload: P) => S | Promise<S>,
  initial: Awaited<S>,
) {
  const [state, dispatch, pending] = useActionState<S, P | typeof RESET>(
    (prev, payload) => (payload === RESET ? initial : action(prev, payload as P)),
    initial,
  );
  const submitted = useRef(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  useLayoutEffect(
    () => () => {
      if (!submitted.current) return;
      submitted.current = false;
      formRef.current?.reset();
      startTransition(() => dispatch(RESET));
    },
    [dispatch],
  );

  const run = (payload: P) => {
    submitted.current = true;
    dispatch(payload);
  };
  return [state, run, pending, formRef] as const;
}
