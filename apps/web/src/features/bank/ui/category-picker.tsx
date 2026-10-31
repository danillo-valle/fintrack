"use client";

// Categoria em um clique (M09.1, pranchas E-Cartao, E-CelCartao e E-CelCategoria do canvas).
//
//   com categoria   [M] Mercado [≡ Regra]  ›       a linha inteira abre a troca (M10.1: a
//                                                   etiqueta diz quem sugeriu e a confiança)
//   sem categoria   [+ Escolher categoria]          botão tracejado azul (texto, ícone e borda:
//                                                   a cor nunca é o único sinal)
//
// Um clique abre a escolha NO LUGAR: no computador, um balão ao lado da linha; no celular, um
// painel que sobe da base. Tocar numa categoria já grava e fecha (sem "confirmar"). A busca filtra
// as categorias do lar e oferece "Criar “texto”"; "Sempre categorizar assim" cria a regra junto.
//
// M13.2: o nome digitado que já existe no OUTRO tipo (uma receita, num gasto) vira um aviso com o
// caminho para ela, em vez de um "Criar" que o banco recusaria; e, num recebido ainda na revisão,
// "É transferência" (para alguém do lar ou para uma conta sua fora do FinTrack) no pé do painel.
//
// Feito com <details>/<summary> e um <form> com a Server Action direta: abre, escolhe e grava
// mesmo antes do JavaScript carregar (regra do M08). O JavaScript só acrescenta a busca, o Esc,
// o "um aberto por vez" e devolver o foco à linha depois de escolher.
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, ChevronRight, Plus, Search, TriangleAlert, X } from "lucide-react";
import { ActionForm } from "@/components/feedback/action-form";
import type { CategorizationSource } from "@fintrack/core";
import { IconTile } from "@/components/visual/icon-tile";
import { SourcePill } from "@/components/visual/source-pill";
import { toneFor } from "@/components/visual/tone";
import { cn } from "@/lib/utils";
import { markTransferAction, setCategoryAction, type CategoryState } from "../server/actions";

export type CategoryChoice = { id: string; name: string; parent: string | null };

const INITIAL: CategoryState = { error: null, success: null, categoryId: null };
const MOST_USED = 6;
const SEARCH_RESULTS = 8;

const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function CategoryPicker({
  item,
  choices,
  full = false,
  others,
  offerTransfer = false,
}: {
  item: {
    id: string;
    description: string;
    category: { id: string; name: string; parent: string | null } | null;
    categorizedBy: CategorizationSource | null;
    categorizationConfidence?: number | null;
  };
  /** As categorias do tipo do lançamento (despesa ou receita), as mais usadas primeiro */
  choices: readonly CategoryChoice[];
  /** Ocupa a largura toda (a linha do celular) */
  full?: boolean;
  /** As categorias do OUTRO tipo (M13.2): um nome que já existe lá vira aviso, não "Criar" */
  others?: { kind: "despesa" | "receita"; choices: readonly CategoryChoice[] };
  /** Oferece "É transferência" (M13.2): só num recebido ainda na revisão, que a pessoa edita */
  offerTransfer?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const panelId = useId();
  const titleId = useId();
  const searchId = useId();
  const ruleId = useId();

  const close = () => {
    const details = ref.current;
    if (!details?.open) return;
    details.open = false;
    summaryRef.current?.focus();
  };

  // Um aberto por vez: abrir este fecha os outros da página
  const onToggle = () => {
    const details = ref.current;
    if (!details?.open) return;
    for (const other of document.querySelectorAll<HTMLDetailsElement>(
      "details[data-category-picker][open]",
    )) {
      if (other !== details) other.open = false;
    }
    details.querySelector<HTMLInputElement>("input[type=search]")?.focus();
  };

  const q = plain(query);
  const shown = q
    ? choices
        .filter((c) => plain(`${c.parent ?? ""} ${c.name}`).includes(q))
        .slice(0, SEARCH_RESULTS)
    : choices.slice(0, MOST_USED);
  const exact = choices.some((c) => plain(c.name) === q);
  const conflict = q && !exact ? (others?.choices.find((c) => plain(c.name) === q) ?? null) : null;

  return (
    <details
      ref={ref}
      data-category-picker
      onToggle={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
      className={cn("group relative", full ? "w-full" : "min-w-0")}
    >
      <summary
        ref={summaryRef}
        aria-controls={panelId}
        className={cn(
          "focus-visible:ring-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl outline-none focus-visible:ring-3 [&::-webkit-details-marker]:hidden",
          item.category
            ? "hover:bg-muted py-1 pr-2.5 pl-1"
            : "border-chart-1-ink text-chart-1-ink justify-center border-[1.5px] border-dashed bg-[color-mix(in_srgb,var(--chart-1)_14%,transparent)] px-3.5 text-sm font-bold",
          full && "w-full",
        )}
      >
        {item.category ? (
          <>
            <IconTile
              tone={toneFor(item.category.id)}
              letter={item.category.name}
              size="sm"
              className="size-7 rounded-lg"
            />
            <span className="flex min-w-0 flex-col items-start gap-1 text-left leading-tight">
              <span className="truncate text-sm font-semibold">{item.category.name}</span>
              {item.categorizedBy ? (
                <SourcePill
                  source={item.categorizedBy}
                  confidence={item.categorizationConfidence ?? null}
                  className="h-5"
                />
              ) : null}
            </span>
            <span className="sr-only"> · trocar categoria de {item.description}</span>
            <ChevronRight aria-hidden className="text-muted-foreground ml-auto size-4 shrink-0" />
          </>
        ) : (
          <>
            <Plus aria-hidden className="size-4" />
            Escolher categoria<span className="sr-only"> de {item.description}</span>
          </>
        )}
      </summary>

      {/* Véu do celular: tocar fora fecha (no computador, o balão não tem véu) */}
      <div aria-hidden onClick={close} className="bg-scrim fixed inset-0 z-[60] md:hidden" />
      <div
        id={panelId}
        role="dialog"
        aria-labelledby={titleId}
        className={cn(
          "bg-card text-card-foreground z-[61] flex flex-col gap-2.5 border shadow-[0_18px_50px_rgb(4_6_20/0.3)]",
          // Celular: painel que sobe da base. Computador: balão de 360 px ao lado da linha
          "fixed inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-3xl px-4 pt-3 pb-7",
          "md:absolute md:inset-x-auto md:top-[calc(100%-2px)] md:right-0 md:bottom-auto md:max-h-none md:w-[22.5rem] md:rounded-[1.125rem] md:p-3.5",
        )}
      >
        <span aria-hidden className="bg-border mx-auto h-1.5 w-10 rounded-full md:hidden" />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 id={titleId} className="text-base font-bold md:text-[0.9375rem]">
              Categoria<span className="md:hidden">:</span>{" "}
              <span className="font-semibold md:font-bold">{item.description}</span>
            </h3>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Fechar"
            className="hover:bg-muted focus-visible:ring-ring -my-2 -mr-2 grid size-11 shrink-0 place-items-center rounded-xl outline-none focus-visible:ring-3"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>

        <ActionForm
          action={setCategoryAction}
          initialState={INITIAL}
          aria-label={`Categoria de ${item.description}`}
        >
          {({ pending, state }) => (
            <PickerBody
              state={state}
              onSaved={close}
              pending={pending}
              item={item}
              shown={shown}
              query={query}
              exact={exact}
              setQuery={setQuery}
              searchId={searchId}
              ruleId={ruleId}
              conflict={conflict && others ? { ...conflict, kind: others.kind } : null}
            />
          )}
        </ActionForm>
        {offerTransfer ? (
          <ActionForm
            action={markTransferAction}
            aria-label={`É transferência: ${item.description}`}
            className="border-t pt-2.5"
          >
            {({ pending, state }) => (
              <TransferChoices
                id={item.id}
                pending={pending}
                saved={Boolean(state.success)}
                onSaved={close}
              />
            )}
          </ActionForm>
        ) : null}
      </div>
    </details>
  );
}

function PickerBody({
  state,
  onSaved,
  pending,
  item,
  shown,
  query,
  exact,
  setQuery,
  searchId,
  ruleId,
  conflict,
}: {
  conflict: { id: string; name: string; kind: "despesa" | "receita" } | null;
  state: CategoryState;
  onSaved: () => void;
  pending: boolean;
  item: { id: string; description: string; category: { id: string } | null };
  shown: readonly CategoryChoice[];
  query: string;
  exact: boolean;
  setQuery: (value: string) => void;
  searchId: string;
  ruleId: string;
}) {
  // Gravou: fecha e devolve o foco à linha (a página volta do servidor com a categoria nova)
  useEffect(() => {
    if (state.success) onSaved();
  }, [state, onSaved]);

  const typed = query.trim();
  return (
    <div className="flex flex-col gap-2.5">
      <input type="hidden" name="transactionId" value={item.id} />
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          Buscar ou criar categoria
        </label>
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-3 left-3 size-[1.125rem]"
        />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar ou criar categoria"
          autoComplete="off"
          // Enter na busca não envia o formulário (envia o botão escolhido)
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          className="bg-background focus-visible:ring-ring h-11 w-full rounded-xl border pr-3 pl-10 text-[0.9375rem] outline-none focus-visible:ring-3"
        />
      </div>
      <span className="text-muted-foreground text-xs font-bold">
        {typed ? "Resultados" : "Mais usadas"}
      </span>
      {shown.length > 0 ? (
        <ul className="grid grid-cols-2 gap-1.5">
          {shown.map((c) => {
            const selected = item.category?.id === c.id;
            return (
              <li key={c.id}>
                <button
                  type="submit"
                  name="categoryId"
                  value={c.id}
                  disabled={pending}
                  aria-pressed={selected}
                  className={cn(
                    "bg-card hover:bg-muted focus-visible:ring-ring flex min-h-12 w-full items-center gap-2 rounded-xl border px-2 py-1.5 text-left outline-none focus-visible:ring-3 disabled:opacity-60",
                    selected && "border-chart-1 border-2",
                  )}
                >
                  <IconTile
                    tone={toneFor(c.id)}
                    letter={c.name}
                    size="sm"
                    className="size-7 rounded-lg"
                  />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-sm font-semibold">{c.name}</span>
                    {c.parent ? (
                      <span className="text-muted-foreground truncate text-xs">{c.parent}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          {typed
            ? "Nenhuma categoria com esse nome."
            : "Nenhuma categoria ainda. Digite o nome para criar a primeira."}
        </p>
      )}
      {conflict ? (
        <div
          role="note"
          className="flex items-start gap-2.5 rounded-xl bg-[color-mix(in_srgb,var(--chart-4)_14%,transparent)] px-3 py-2.5 text-sm"
          data-testid="categoria-outro-tipo"
        >
          <TriangleAlert aria-hidden className="text-chart-4-ink mt-0.5 size-4 shrink-0" />
          <span className="flex flex-col gap-1">
            <strong>
              “{conflict.name}” já existe como {conflict.kind}
            </strong>
            <span className="text-muted-foreground">
              Aqui só aparecem as de {conflict.kind === "receita" ? "despesa" : "receita"}, e o nome
              não se repete no lar.
            </span>
            <Link
              href={`/ajustes/categorias/${conflict.id}`}
              className="text-chart-1-ink font-bold underline underline-offset-4"
            >
              Abrir {conflict.name} em Categorias
            </Link>
          </span>
        </div>
      ) : null}
      {typed && !exact && !conflict ? (
        <button
          type="submit"
          name="newCategory"
          value={typed}
          disabled={pending}
          className="text-chart-1-ink hover:bg-muted focus-visible:ring-ring flex min-h-11 items-center gap-2 rounded-xl border border-dashed px-3 text-sm font-bold outline-none focus-visible:ring-3"
        >
          <Plus aria-hidden className="size-4" />
          Criar “{typed.slice(0, 60)}”
        </button>
      ) : null}
      <label htmlFor={ruleId} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
        <input id={ruleId} type="checkbox" name="rememberRule" className="accent-primary size-5" />
        Sempre categorizar “{item.description}” assim
      </label>
      <span className="text-muted-foreground text-xs">
        Tocar numa categoria já salva. A escolha vira exemplo para as próximas sugestões.
      </span>
    </div>
  );
}

/** "É transferência" no pé do painel (M13.2): marca só este lado; o outro a pessoa não vê. */
function TransferChoices({
  id,
  pending,
  saved,
  onSaved,
}: {
  id: string;
  pending: boolean;
  saved: boolean;
  onSaved: () => void;
}) {
  useEffect(() => {
    if (saved) onSaved();
  }, [saved, onSaved]);
  const option =
    "bg-card hover:bg-muted focus-visible:ring-ring flex min-h-11 w-full items-center gap-2 rounded-xl border px-3 text-left text-sm font-semibold outline-none focus-visible:ring-3 disabled:opacity-60";
  return (
    <div className="flex flex-col gap-1.5">
      <input type="hidden" name="intent" value="mark" />
      <input type="hidden" name="transactionId" value={id} />
      <span className="text-muted-foreground text-xs font-bold">
        Não é gasto nem receita? É transferência
      </span>
      <button type="submit" name="peer" value="HOUSEHOLD" disabled={pending} className={option}>
        <ArrowLeftRight aria-hidden className="size-4 shrink-0" />
        Para alguém do lar
      </button>
      <button type="submit" name="peer" value="EXTERNAL" disabled={pending} className={option}>
        <ArrowLeftRight aria-hidden className="size-4 shrink-0" />
        Para uma conta minha fora do FinTrack
      </button>
    </div>
  );
}
