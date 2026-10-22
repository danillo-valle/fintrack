"use client";

// O interruptor da IA local (M10.2b, pranchas F-Inteligencia e F2-IaLocal): um <form> com a
// Server Action direta (funciona antes do React, regra do M08). O botão é o interruptor comum
// do FinTrack (components/visual/switch-button.tsx).
import { ActionForm } from "@/components/feedback/action-form";
import { SwitchButton } from "@/components/visual/switch-button";
import { setLocalAiAction } from "../server/actions";

export function LocalAiSwitch({ on, labelledBy }: { on: boolean; labelledBy: string }) {
  return (
    <ActionForm action={setLocalAiAction} aria-label="Ligar ou desligar a IA local">
      {({ pending }) => (
        <>
          <input type="hidden" name="enabled" value={on ? "false" : "true"} />
          <SwitchButton on={on} labelledBy={labelledBy} disabled={pending} />
        </>
      )}
    </ActionForm>
  );
}
