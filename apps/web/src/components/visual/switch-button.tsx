// O interruptor do FinTrack (M10.2b, levado para cá no M11): um botão de enviar que É o
// interruptor (role="switch", aria-checked). Fica DENTRO de um <form> com a Server Action direta
// (ActionForm): apertar envia o estado contrário, e funciona antes do React carregar.
//
//   <ActionForm action={setBotEnabledAction} aria-label="Ligar ou desligar o bot">
//     {({ pending }) => (
//       <>
//         <input type="hidden" name="enabled" value={on ? "false" : "true"} />
//         <SwitchButton on={on} labelledBy="bot-h" disabled={pending} />
//       </>
//     )}
//   </ActionForm>
//
// Cor não é o único sinal: a bolinha muda de lado, e o texto de estado fica ao lado (WCAG 1.4.1).
import { cn } from "@/lib/utils";

export function SwitchButton({
  on,
  labelledBy,
  disabled,
  testId,
}: {
  on: boolean;
  labelledBy: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="submit"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelledBy}
      disabled={disabled}
      data-testid={testId}
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
  );
}
