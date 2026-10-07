// Estado que as Server Actions do M06 devolvem para o formulário (useActionState).
// Arquivo sem "server-only": o componente do navegador também importa o tipo e o valor inicial.

/** error: o que deu errado (aparece no aviso vermelho); success: a confirmação (aviso verde). */
export type ActionState = { error: string | null; success: string | null };

export const INITIAL_ACTION_STATE: ActionState = { error: null, success: null };
