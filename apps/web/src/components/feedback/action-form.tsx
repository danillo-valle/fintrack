"use client";

// Formulário ligado a uma Server Action do M06, com os padrões do projeto embutidos:
//   - noValidate + useFieldErrors: aviso em português embaixo do campo (regra do M03)
//   - FormAlert: erro (vermelho, role="alert") ou confirmação (verde, role="status")
//   - pending: o botão desabilita enquanto o servidor responde (sem clique duplo)
//
//   <ActionForm action={renameWalletAction}>
//     {({ pending, field }) => (
//       <>
//         <input type="hidden" name="walletId" value={id} />
//         <Input name="name" required {...field("name").props} />
//         <FieldError id={field("name").errorId}>{field("name").error}</FieldError>
//         <Button disabled={pending}>Salvar</Button>
//       </>
//     )}
//   </ActionForm>
import { useActionState, useReducer, useState, type ReactNode } from "react";
// O FormAlert nasceu no M03 dentro de auth, mas é genérico: reaproveitado aqui
import { FormAlert } from "@/features/auth/ui/form-alert";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/action-state";
import { useFieldErrors } from "@/lib/use-field-errors";
import { useRenewWhenHidden } from "@/lib/use-renew-when-hidden";

type Field = {
  props: ReturnType<ReturnType<typeof useFieldErrors>["fieldProps"]>;
  error: string | undefined;
  errorId: string;
};

type Props<S extends ActionState> = {
  action: (prev: S, formData: FormData) => Promise<S>;
  initialState?: S;
  /** Prefixo dos ids (vários formulários na mesma página não podem repetir id) */
  idPrefix?: string;
  className?: string;
  /** id do <form>: os botões do rodapé de um modal ligam-se a ele com form="…" (M09.1) */
  id?: string;
  /** Rótulo acessível do formulário (aparece para leitor de tela como região "form") */
  "aria-label"?: string;
  children: (helpers: {
    pending: boolean;
    state: S;
    /** Liga um campo aos avisos. helpId: id da ajuda do campo (lida depois do erro) */
    field: (name: string, options?: { helpId?: string }) => Field;
  }) => ReactNode;
};

export function ActionForm<S extends ActionState>(props: Props<S>) {
  // Cache Components (M08): a tela escondida depois de um envio volta com o formulário novo
  // (outra `key`), sem o aviso de antes. Veja lib/use-renew-when-hidden.ts.
  const [generation, renew] = useReducer((n: number) => n + 1, 0);
  return <ActionFormBody key={generation} {...props} renew={renew} />;
}

function ActionFormBody<S extends ActionState>({
  action,
  initialState,
  idPrefix = "",
  className,
  id,
  children,
  renew,
  ...aria
}: Props<S> & { renew: () => void }) {
  // Awaited<S>: o tipo que o React espera para o estado (S é um objeto simples, então é o próprio S).
  // A Server Action vai direto para o useActionState e daí para o <form>: assim o formulário
  // funciona antes do JavaScript carregar (aprimoramento progressivo).
  const [state, formAction, pending] = useActionState<S, FormData>(
    action,
    (initialState ?? INITIAL_ACTION_STATE) as Awaited<S>,
  );
  const [pristine] = useState(state);
  useRenewWhenHidden(state !== pristine, renew);
  const { errors, validate, fieldProps, errorId, alertId } = useFieldErrors(idPrefix);

  const field = (name: string, options: { helpId?: string } = {}): Field => ({
    props: fieldProps(name, { ...options, linkAlert: Boolean(state.error) }),
    error: errors[name],
    errorId: errorId(name),
  });

  return (
    <form
      id={id}
      action={formAction}
      noValidate
      className={className}
      aria-label={aria["aria-label"]}
      // A conferência roda antes; com erro, o envio nem acontece (o foco vai ao campo)
      onSubmit={(event) => {
        if (!validate(event.currentTarget)) event.preventDefault();
      }}
    >
      <FormAlert id={alertId} message={state.error} />
      <FormAlert message={state.error ? null : state.success} variant="success" />
      {children({ pending, state, field })}
    </form>
  );
}
