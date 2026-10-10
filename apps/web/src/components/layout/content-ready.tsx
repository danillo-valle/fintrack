"use client";

import { useEffect, useRef } from "react";

// Marca, depois do commit, que o conteúdo da página já está ligado ao React (M08).
//
// Com o Cache Components, o conteúdo de cada página fica na fronteira de Suspense do loading.tsx
// e hidrata depois da moldura (o data-hydrated do providers.tsx marca só a moldura). Uma tecla
// digitada antes do commit some: a hidratação repõe o valor do React no campo. O React grava a
// chave interna do elemento já na fase de renderização, antes do commit; um efeito só roda depois
// dele. Por isso a marca vem de um efeito: o HTML do servidor sai com "carregando" e o efeito troca
// para "pronto". Os testes E2E (openPage, waitForContent) esperam não haver nenhum "carregando".
export function ContentReady() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.dataset.content = "pronto";
  }, []);
  return <span ref={ref} hidden data-content="carregando" />;
}
