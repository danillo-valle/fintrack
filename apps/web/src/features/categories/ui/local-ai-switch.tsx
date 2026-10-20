"use client";

// O interruptor da IA local (M10.2b, pranchas F-Inteligencia e F2-IaLocal): um <form> com a
// Server Action direta (funciona antes do React, regra do M08). O botão é o próprio interruptor
// (role="switch", aria-checked): apertar envia o estado contrário.
import { ActionForm } from "@/components/feedback/action-form";
import { cn } from "@/lib/utils";
import { setLocalAiAction } from "../server/actions";

export function LocalAiSwitch({ on, labelledBy }: { on: boolean; labelledBy: string }) {
  return (
    <ActionForm action={setLocalAiAction} aria-label="Ligar ou desligar a IA local">
      {({ pending }) => (
        <>
          <input type="hidden" name="enabled" value={on ? "false" : "true"} />
          <button
            type="submit"
            role="switch"
            aria-checked={on}
            aria-labelledby={labelledBy}
            disabled={pending}
            className={cn(
              "focus-visible:ring-ring relative h-[2.125rem] w-[3.75rem] shrink-0 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60",
              on ? "bg-primary" : "bg-muted-foreground/40",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "bg-background absolute top-1 size-[1.625rem] rounded-full shadow transition-[left]",
                on ? "left-[1.875rem]" : "left-1",
              )}
            />
          </button>
        </>
      )}
    </ActionForm>
  );
}
