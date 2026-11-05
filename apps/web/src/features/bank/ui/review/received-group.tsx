// Os recebidos sem par de uma fatura (cartão) ou de uma conta (M09.2, pranchas E2-Revisao e
// E2-CelRevisao), com "Confirmar os N com categoria" do grupo e o "Confirmar" de cada linha.
//
//   lista larga  descrição ............................................ valor
//                data · cartão
//                [ categoria ] [ O que foi ] [?]          [ ambiente ] [ Confirmar ]
//   estreita     descrição ............................................ valor
//                data · cartão
//                [ categoria              ] [ O que foi        ] [?]
//                [ ambiente               ] [ Confirmar ]
//
// Larga ou estreita é a largura da LISTA (contêiner, @2xl = 42rem), não da tela. Até a revisão 2 do
// M13.2, o computador tinha uma linha só com seis colunas, que precisava de ~62rem com o "O que
// foi"; a lista tem no máximo ~57rem, e a descrição e o cartão entravam na coluna da categoria.
//
// M13.2 (prancha M-Revisao): o "O que foi" ao lado da categoria, o nome da pessoa em destaque com o
// texto do banco embaixo, e a transferência marcada de um lado só (com "Desmarcar").
//
// [?] (M10.1, prancha F-Sugestoes): "Por que essa categoria?", a cascata camada por camada, num
// modal por cima da revisão. A etiqueta da categoria diz quem sugeriu e com que confiança.
//
// M10.2b (pranchas F2-Recebidos e F2-CelRecebidos): embaixo da categoria, a linha da IA local:
//   na fila     [┆ Na fila da IA] aguardando a IA, que olha de madrugada
//   proposta    [✦ IA local · nova] Criar “Academia”? em Saúde       [Criar e aplicar]
// O "Criar e aplicar" abre o modal (rota /criar/[id]) e só aparece para quem mexe nas
// categorias do lar e edita a carteira do recebido.
import Link from "next/link";
import { CircleHelp, Clock, Sparkles } from "lucide-react";
import { LOCAL_AI_WINDOW_TEXT } from "@fintrack/core";
import type { ReceivedView, ReviewGroup } from "../../server/review";
import { AmountText } from "@/components/money/amount-text";
import { NativeSelect } from "@/components/ui/native-select";
import { TEXT_LINK } from "@/lib/styles";
import { CategoryPicker, type CategoryChoice } from "../category-picker";
import { LabelEditor } from "../label-editor";
import { TransferMark } from "../transfer-mark";
import { civilDayMonth } from "@/lib/dates";
import { CardChip, CategoryLabel, monthName, SMALL_BUTTON, SMALL_PRIMARY } from "./parts";
import { ReviewForm, ReviewSubmit } from "./review-actions";

/** Quantas linhas cada grupo mostra antes do "Ver os outros N". */
export const GROUP_PREVIEW = 5;

export function groupTitle(group: Pick<ReviewGroup, "accountName" | "statementMonth">) {
  return group.statementMonth
    ? `${group.accountName} · fatura de ${monthName(group.statementMonth)}`
    : group.accountName;
}

type Choices = { expense: readonly CategoryChoice[]; income: readonly CategoryChoice[] };
type Wallet = { id: string; name: string };

/** A linha da IA local embaixo da categoria (na fila, ou a proposta de categoria nova). */
function LocalAiLine({ item, canCreate }: { item: ReceivedView; canCreate: boolean }) {
  const { queued, proposal } = item.localAi;
  if (proposal) {
    return (
      <div
        className="border-chart-1 col-span-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-xl border bg-[color-mix(in_srgb,var(--chart-1)_10%,transparent)] px-3 py-2"
        data-testid="proposta-ia"
      >
        <span className="text-chart-1-ink inline-flex h-6 items-center gap-1.5 rounded-full border border-current px-2 text-xs font-semibold">
          <Sparkles aria-hidden className="size-3.5" />
          IA local · nova
        </span>
        <span className="min-w-0 flex-1 text-sm">
          <strong className="text-chart-1-ink">Criar “{proposal.name}”?</strong>{" "}
          <span className="text-muted-foreground">
            {proposal.parent ? `em ${proposal.parent.name} · ` : ""}nenhuma da casa serviu
          </span>
        </span>
        {canCreate ? (
          <Link
            href={`/lancamentos/recebidos/criar/${item.id}`}
            scroll={false}
            aria-label={`Criar e aplicar ${proposal.name}: ${item.description}`}
            className={SMALL_PRIMARY}
          >
            Criar e aplicar
          </Link>
        ) : null}
      </div>
    );
  }
  if (!queued) return null;
  return (
    <p
      className="text-muted-foreground col-span-2 flex flex-wrap items-center gap-2 text-[0.8125rem]"
      data-testid="na-fila-ia"
    >
      <span className="border-chart-4-ink text-chart-4-ink inline-flex h-6 items-center gap-1.5 rounded-full border-[1.5px] border-dashed px-2 text-xs font-semibold">
        <Clock aria-hidden className="size-3.5" />
        Na fila da IA
      </span>
      Aguardando a IA local, que olha à noite, {LOCAL_AI_WINDOW_TEXT}
    </p>
  );
}

function ReceivedRow({
  item,
  choices,
  wallets,
  canManageCategories,
}: {
  item: ReceivedView;
  choices: Choices;
  wallets: readonly Wallet[];
  canManageCategories: boolean;
}) {
  const walletOptions = wallets.some((w) => w.id === item.wallet.id)
    ? wallets
    : [item.wallet, ...wallets];
  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-2 py-3 @2xl:gap-x-4"
      data-testid="recebido"
    >
      <span className="col-start-1 row-start-1 flex min-w-0 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[0.9375rem] font-semibold">
              {item.label ?? item.description}
            </span>
            {item.label ? (
              <span className="text-muted-foreground tabular truncate font-mono text-xs">
                {item.description}
              </span>
            ) : null}
          </span>
          {item.installment ? (
            <span className="bg-muted tabular shrink-0 rounded-full px-2 py-0.5 font-mono text-xs font-bold">
              <span className="sr-only">parcela </span>
              {item.installment.number}/{item.installment.count}
            </span>
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground tabular font-mono text-xs">
            {civilDayMonth(item.occurredOn)}
          </span>
          <CardChip card={item.card} unknownLastFour={item.unknownLastFour} />
        </span>
      </span>
      <AmountText
        cents={item.amount}
        tone="inherit"
        arrow={false}
        className="col-start-2 row-start-1 self-start justify-self-end text-[0.9375rem] font-bold"
      />
      <span className="col-span-2 flex min-w-0 items-center gap-1.5 @2xl:col-span-1">
        <span className="min-w-0 flex-1">
          {item.isTransfer ? (
            <TransferMark item={item} canEdit={item.canEdit} />
          ) : item.canEdit ? (
            <CategoryPicker
              item={item}
              choices={item.amount < 0n ? choices.expense : choices.income}
              others={
                item.amount < 0n
                  ? { kind: "receita", choices: choices.income }
                  : { kind: "despesa", choices: choices.expense }
              }
              offerTransfer
              full
            />
          ) : (
            <CategoryLabel
              category={item.category}
              categorizedBy={item.categorizedBy}
              confidence={item.categorizationConfidence}
            />
          )}
        </span>
        {item.canEdit ? (
          <span className="min-w-0 flex-1">
            <LabelEditor item={item} full />
          </span>
        ) : null}
        {item.isTransfer ? null : (
          <Link
            href={`/lancamentos/recebidos/por-que/${item.id}`}
            scroll={false}
            aria-label={`Por que essa categoria: ${item.description}`}
            title="Por que essa categoria?"
            className="text-muted-foreground hover:bg-muted focus-visible:ring-ring grid size-11 shrink-0 place-items-center rounded-xl outline-none focus-visible:ring-3"
          >
            <CircleHelp aria-hidden className="size-[1.125rem]" />
          </Link>
        )}
      </span>
      {item.canEdit ? (
        <ReviewForm
          intent="confirm"
          fields={{ transactionId: item.id }}
          label={`Confirmar ${item.description}`}
          className="col-span-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2 @2xl:col-span-1 @2xl:grid-cols-[9rem_auto]"
        >
          <NativeSelect
            name="walletId"
            aria-label={`Ambiente de ${item.description}`}
            defaultValue={item.wallet.id}
            className="h-11 rounded-[0.625rem]"
          >
            {walletOptions.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </NativeSelect>
          <ReviewSubmit className={SMALL_BUTTON} label={`Confirmar ${item.description}`}>
            Confirmar
          </ReviewSubmit>
        </ReviewForm>
      ) : (
        <span className="text-muted-foreground col-span-2 text-sm @2xl:col-span-1">
          {item.wallet.name}
        </span>
      )}
      <LocalAiLine item={item} canCreate={canManageCategories && item.canEdit} />
    </li>
  );
}

export function ReceivedGroup({
  group,
  choices,
  wallets,
  expanded,
  expandHref,
  canManageCategories = false,
}: {
  group: ReviewGroup;
  choices: Choices;
  wallets: readonly Wallet[];
  expanded: boolean;
  expandHref: string;
  /** M10.2b: mostra o "Criar e aplicar" da categoria que a IA local propôs */
  canManageCategories?: boolean;
}) {
  const id = `grupo-${group.key.replace(":", "-")}`;
  const shown = expanded ? group.items : group.items.slice(0, GROUP_PREVIEW);
  const hidden = group.items.length - shown.length;
  const title = groupTitle(group);
  return (
    <section
      id={id}
      aria-labelledby={`${id}-titulo`}
      className="bg-card flex flex-col gap-2.5 rounded-[1.125rem] border px-3.5 py-3.5 md:px-5 md:py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={`${id}-titulo`} className="text-[1.0625rem] font-extrabold md:text-xl">
            {title}
          </h2>
          <span className="text-muted-foreground text-[0.8125rem] md:text-sm">
            sem par · {group.items.length} {group.items.length === 1 ? "recebido" : "recebidos"} ·{" "}
            {group.withCategory} com categoria
          </span>
        </div>
        {group.confirmable > 0 ? (
          <ReviewForm
            intent="bulk"
            fields={{ accountId: group.accountId, statementId: group.statementId ?? "" }}
            className="hidden md:block"
          >
            <ReviewSubmit
              className={SMALL_BUTTON}
              label={
                group.confirmable === 1
                  ? `Confirmar o que tem categoria em ${title}`
                  : `Confirmar os ${group.confirmable} com categoria de ${title}`
              }
            >
              {group.confirmable === 1
                ? "Confirmar o que tem categoria"
                : `Confirmar os ${group.confirmable} com categoria`}
            </ReviewSubmit>
          </ReviewForm>
        ) : null}
      </div>
      <ul
        aria-label={`Recebidos sem par: ${title}`}
        className="@container divide-y border-t md:border-t-0"
      >
        {shown.map((item) => (
          <ReceivedRow
            key={item.id}
            item={item}
            choices={choices}
            wallets={wallets}
            canManageCategories={canManageCategories}
          />
        ))}
      </ul>
      {hidden > 0 ? (
        <Link href={expandHref} className={`${TEXT_LINK} self-start text-sm`} scroll={false}>
          Ver {hidden === 1 ? "o outro" : `os outros ${hidden}`}
        </Link>
      ) : null}
    </section>
  );
}
