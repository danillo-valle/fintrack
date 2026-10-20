"use client";

// Os botões da revisão (M09.2) e o aviso com "Desfazer".
//
// Uma action só (reviewAction) atende Confirmar, Confirmar os N, Não é o mesmo e Ligar ao
// original. O estado dela mora AQUI, no topo da página, e não em cada linha: a linha confirmada
// some da lista na mesma resposta, e o aviso com "Desfazer" precisa de alguém que continue na
// tela para mostrá-lo. Cada botão é um <form> com a action vinda do useActionState (pelo
// contexto): funciona antes do JavaScript carregar (regra do M08).
import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useRef,
  useTransition,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { undoToast } from "@/components/feedback/undo-toast";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { cn } from "@/lib/utils";
import {
  reviewAction,
  undoReviewAction,
  type ReviewState,
  type ReviewUndo,
} from "../../server/review-actions";

const INITIAL: ReviewState = { ...INITIAL_ACTION_STATE, undo: null };

type Ctx = { formAction: (formData: FormData) => void; pending: boolean };
const ReviewContext = createContext<Ctx | null>(null);

function useReview(): Ctx {
  const value = useContext(ReviewContext);
  if (!value) throw new Error("ReviewForm fora do ReviewActions");
  return value;
}

/** O que voltou de uma decisão tomada FORA da lista (um modal): o aviso e o "Desfazer" dela. */
/** undo null: não há o que desfazer (M10.2b: a categoria criada pelo "Criar e aplicar") */
export type ReviewReturn = { message: string; undo: ReviewUndo | null; key: string };

export function ReviewActions({
  children,
  returned,
}: {
  children: ReactNode;
  /**
   * Voltou do "Confirmar par" (?juntado=…) ou do "Por que essa categoria?" (?confirmado=…):
   * mostra o aviso com "Desfazer" uma vez
   */
  returned: ReviewReturn | null;
}) {
  const [state, formAction, pending] = useActionState(reviewAction, INITIAL);
  const [, startUndo] = useTransition();
  const shown = useRef(state);
  const router = useRouter();
  const pathname = usePathname();

  const undo = (what: ReviewUndo) =>
    startUndo(async () => {
      const form = new FormData();
      form.set("kind", what.kind);
      if (what.kind === "review") form.set("ids", what.ids.join(","));
      else form.set("matchId", what.matchId);
      const result = await undoReviewAction(INITIAL_ACTION_STATE, form);
      if (result.error) toast.error(result.error);
      else if (result.success) toast(result.success);
    });

  // Cada resposta do servidor é um objeto novo: um aviso por resposta
  useEffect(() => {
    if (state === shown.current) return;
    shown.current = state;
    if (state.error) {
      toast.error(state.error);
      return;
    }
    if (!state.success) return;
    const what = state.undo;
    if (what) undoToast(state.success, { variant: "success", onUndo: () => undo(what) });
    else toast(state.success);
  }, [state]);

  const returnedShown = useRef<string | null>(null);
  useEffect(() => {
    if (!returned || returnedShown.current === returned.key) return;
    returnedShown.current = returned.key;
    const what = returned.undo;
    if (what) undoToast(returned.message, { variant: "success", onUndo: () => undo(what) });
    else toast.success(returned.message);
    // Tira o ?juntado/?confirmado da URL: recarregar não mostra o aviso de novo
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uma vez por decisão
  }, [returned?.key]);

  return <ReviewContext value={{ formAction, pending }}>{children}</ReviewContext>;
}

/**
 * Um botão (ou uma linha com campos) que chama a revisão. `fields` vão escondidos; `children` são
 * os campos visíveis e o botão de enviar. `contents` deixa os filhos no grid de quem chama.
 */
export function ReviewForm({
  intent,
  fields,
  children,
  className,
  label,
}: {
  intent: "confirm" | "bulk" | "reject" | "refund";
  fields: Record<string, string>;
  children: ReactNode;
  className?: string;
  /** Nome do formulário para o leitor de tela ("Confirmar POSTO ESTRELA") */
  label?: string;
}) {
  const { formAction } = useReview();
  return (
    <form action={formAction} aria-label={label} className={cn(className)}>
      <input type="hidden" name="intent" value={intent} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
    </form>
  );
}

/**
 * O botão de enviar de um ReviewForm: fica desabilitado enquanto o servidor responde (sem clique
 * duplo). Os estilos vêm de quem chama (o botão pequeno da linha, o principal do lote...).
 */
export function ReviewSubmit({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const { pending } = useReview();
  return (
    <button type="submit" disabled={pending} aria-label={label} className={className}>
      {children}
    </button>
  );
}
