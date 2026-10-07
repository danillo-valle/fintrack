"use client";

// Um botão que chama uma Server Action com campos escondidos (M06): "Cancelar convite",
// "Remover", "Arquivar". Com `confirm`, o primeiro clique só pergunta; a ação acontece no
// segundo ("Sim, remover"). Sem janela modal: a pergunta aparece no lugar do botão e recebe o
// foco, então funciona igual com teclado, leitor de tela e no celular.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/action-state";
import { ActionForm } from "./action-form";

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  /** Campos escondidos enviados junto (ids, papel...) */
  fields: Record<string, string>;
  children: ReactNode;
  /** Nome acessível completo, quando o texto do botão sozinho é ambíguo ("Remover" quem?) */
  label?: string;
  variant?: "default" | "outline" | "destructive" | "ghost" | "secondary";
  /** Pergunta de confirmação. Sem ela, um clique já executa. */
  confirm?: string;
  /** Texto do botão que confirma ("Sim, remover") */
  confirmLabel?: string;
};

export function ActionButton({
  action,
  fields,
  children,
  label,
  variant = "outline",
  confirm,
  confirmLabel = "Sim, confirmar",
}: Props) {
  const [asking, setAsking] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);

  // Abriu a pergunta: foco no "Sim". Cancelou: foco de volta no botão original
  useEffect(() => {
    if (asking) confirmRef.current?.focus();
    else if (wasAsking.current) triggerRef.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  return (
    <ActionForm action={action} className="contents">
      {({ pending }) => (
        <>
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {confirm && asking ? (
            <span role="group" aria-label={confirm} className="flex flex-wrap items-center gap-2">
              <span className="text-sm">{confirm}</span>
              <Button
                ref={confirmRef}
                type="submit"
                size="sm"
                variant="destructive"
                disabled={pending}
              >
                {pending ? "Aguarde…" : confirmLabel}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(false)}>
                Não
              </Button>
            </span>
          ) : (
            <Button
              ref={triggerRef}
              type={confirm ? "button" : "submit"}
              size="sm"
              variant={variant}
              aria-label={label}
              disabled={pending}
              onClick={confirm ? () => setAsking(true) : undefined}
            >
              {children}
            </Button>
          )}
        </>
      )}
    </ActionForm>
  );
}
