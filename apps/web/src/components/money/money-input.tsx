"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { appendDigits, centsToDecimal, digitsToCents, dropLastDigit, formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

type InputProps = React.ComponentProps<typeof Input>;

type Props = Omit<InputProps, "value" | "defaultValue" | "onChange" | "type" | "inputMode"> & {
  /** Nome do campo no formulário. O valor enviado é decimal: "1234.56". */
  name?: string;
  /** Valor controlado, em centavos */
  value?: bigint;
  /** Valor inicial, em centavos, quando o campo não é controlado */
  defaultValue?: bigint;
  onValueChange?: (cents: bigint) => void;
};

// Mantém o cursor sempre no fim, onde os dígitos entram
function moveCaretToEnd(el: HTMLInputElement | null) {
  if (el && document.activeElement === el) {
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }
}

// Todo o texto do campo está selecionado? (acontece ao chegar pelo Tab)
function isAllSelected(el: HTMLInputElement): boolean {
  return el.selectionStart === 0 && el.selectionEnd === el.value.length && el.value.length > 0;
}

// Campo de valor em reais, digitado como numa maquininha: os dígitos entram pela direita.
// Digitar 1, 2, 3, 4 mostra R$ 0,01 → R$ 0,12 → R$ 1,23 → R$ 12,34.
// No celular, inputMode="numeric" abre o teclado numérico.
export function MoneyInput({
  name,
  value,
  defaultValue = 0n,
  onValueChange,
  className,
  onFocus,
  ref: externalRef,
  ...props
}: Props) {
  const [internal, setInternal] = useState<bigint>(defaultValue);
  const cents = value ?? internal;
  const ref = useRef<HTMLInputElement | null>(null);
  // O campo precisa da própria referência (para o cursor e o beforeinput) e também repassa
  // a referência a quem usa o componente (por exemplo, para levar o foco até ele num erro)
  const setRefs = useCallback(
    (el: HTMLInputElement | null) => {
      ref.current = el;
      if (typeof externalRef === "function") externalRef(el);
      else if (externalRef) externalRef.current = el;
    },
    [externalRef],
  );

  // Guardam a versão mais recente do valor e da função de atualização,
  // para o listener abaixo nunca trabalhar com um valor antigo
  const latest = useRef<{ cents: bigint; update: (next: bigint) => void }>({
    cents,
    update: () => {},
  });
  useLayoutEffect(() => {
    latest.current = {
      cents,
      update: (next: bigint) => {
        if (value === undefined) setInternal(next);
        onValueChange?.(next);
      },
    };
  });

  // A cada novo valor, devolve o cursor ao fim
  useLayoutEffect(() => moveCaretToEnd(ref.current), [cents]);

  // "beforeinput" diz o que a pessoa QUIS fazer (inserir "5", apagar), antes de o navegador
  // alterar o texto. Assim o resultado não depende de onde o cursor está.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function handleBeforeInput(event: InputEvent) {
      if (!el) return;
      const { cents: current, update } = latest.current;
      const base = isAllSelected(el) ? 0n : current;

      if (event.inputType === "insertText" || event.inputType === "insertReplacementText") {
        event.preventDefault();
        update(appendDigits(base, event.data ?? ""));
      } else if (event.inputType.startsWith("delete")) {
        event.preventDefault();
        update(isAllSelected(el) ? 0n : dropLastDigit(current));
      }
    }

    el.addEventListener("beforeinput", handleBeforeInput);
    return () => el.removeEventListener("beforeinput", handleBeforeInput);
  }, []);

  return (
    <>
      <Input
        {...props}
        ref={setRefs}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={formatBRL(cents)}
        // Reserva para casos raros que não passam pelo beforeinput (preenchimento automático)
        onChange={(event) => latest.current.update(digitsToCents(event.target.value))}
        onPaste={(event) => {
          // Colar "1.234,56" substitui o valor inteiro
          event.preventDefault();
          latest.current.update(digitsToCents(event.clipboardData.getData("text")));
        }}
        onFocus={(event) => {
          onFocus?.(event);
          const el = event.currentTarget;
          requestAnimationFrame(() => moveCaretToEnd(el));
        }}
        className={cn("tabular text-right", className)}
      />
      {name ? <input type="hidden" name={name} value={centsToDecimal(cents)} /> : null}
    </>
  );
}
