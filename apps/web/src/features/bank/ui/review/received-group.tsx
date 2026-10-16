// Os recebidos sem par de uma fatura (cartão) ou de uma conta (M09.2, pranchas E2-Revisao e
// E2-CelRevisao), com "Confirmar os N com categoria" do grupo e o "Confirmar" de cada linha.
//
//   computador  data | descrição + cartão | categoria [?] | ambiente | valor | Confirmar
//   celular     descrição ............................................ valor
//               data · cartão
//               [ categoria (quase toda a largura)        ] [?]
//               [ ambiente               ] [ Confirmar ]
//
// [?] (M10.1, prancha F-Sugestoes): "Por que essa categoria?", a cascata camada por camada, num
// modal por cima da revisão. A etiqueta da categoria diz quem sugeriu e com que confiança.
import Link from "next/link";
import { CircleHelp } from "lucide-react";
import type { ReceivedView, ReviewGroup } from "../../server/review";
import { AmountText } from "@/components/money/amount-text";
import { NativeSelect } from "@/components/ui/native-select";
import { TEXT_LINK } from "@/lib/styles";
import { CategoryPicker, type CategoryChoice } from "../category-picker";
import { CardChip, CategoryLabel, dayMonth, monthName, SMALL_BUTTON } from "./parts";
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

function ReceivedRow({
  item,
  choices,
  wallets,
}: {
  item: ReceivedView;
  choices: Choices;
  wallets: readonly Wallet[];
}) {
  const walletOptions = wallets.some((w) => w.id === item.wallet.id)
    ? wallets
    : [item.wallet, ...wallets];
  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-2 py-3 md:grid-cols-[3rem_minmax(0,1fr)_15rem_6.5rem_6.5rem_6rem] md:items-center md:gap-x-3 md:py-2.5"
      data-testid="recebido"
    >
      <span className="text-muted-foreground tabular hidden font-mono text-[0.8125rem] md:col-start-1 md:row-start-1 md:block">
        {dayMonth(item.occurredOn)}
      </span>
      <span className="col-start-1 row-start-1 flex min-w-0 flex-col gap-1 md:col-start-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[0.9375rem] font-semibold">{item.description}</span>
          {item.installment ? (
            <span className="bg-muted tabular shrink-0 rounded-full px-2 py-0.5 font-mono text-xs font-bold">
              <span className="sr-only">parcela </span>
              {item.installment.number}/{item.installment.count}
            </span>
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground tabular font-mono text-xs md:hidden">
            {dayMonth(item.occurredOn)}
          </span>
          <CardChip card={item.card} unknownLastFour={item.unknownLastFour} />
        </span>
      </span>
      <AmountText
        cents={item.amount}
        tone="inherit"
        arrow={false}
        className="col-start-2 row-start-1 self-start justify-self-end text-[0.9375rem] font-bold md:col-start-5 md:self-center"
      />
      <span className="col-span-2 flex min-w-0 items-center gap-1 md:col-span-1 md:col-start-3 md:row-start-1">
        <span className="min-w-0 flex-1">
          {item.isTransfer ? (
            <span className="text-muted-foreground text-sm">Transferência</span>
          ) : item.canEdit ? (
            <CategoryPicker
              item={item}
              choices={item.amount < 0n ? choices.expense : choices.income}
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
        {item.isTransfer ? null : (
          <Link
            href={`/lancamentos/recebidos/por-que/${item.id}`}
            scroll={false}
            aria-label={`Por que essa categoria: ${item.description}`}
            title="Por que essa categoria?"
            className="text-muted-foreground hover:bg-muted focus-visible:ring-ring grid size-11 shrink-0 place-items-center rounded-xl outline-none focus-visible:ring-3 md:size-9"
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
          className="col-span-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2 md:contents"
        >
          <NativeSelect
            name="walletId"
            aria-label={`Ambiente de ${item.description}`}
            defaultValue={item.wallet.id}
            className="h-11 rounded-[0.625rem] md:col-start-4 md:row-start-1 md:h-9"
          >
            {walletOptions.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </NativeSelect>
          <ReviewSubmit
            className={`${SMALL_BUTTON} md:col-start-6 md:row-start-1 md:justify-self-end`}
            label={`Confirmar ${item.description}`}
          >
            Confirmar
          </ReviewSubmit>
        </ReviewForm>
      ) : (
        <span className="text-muted-foreground col-span-2 text-sm md:col-span-1 md:col-start-4 md:row-start-1">
          {item.wallet.name}
        </span>
      )}
    </li>
  );
}

export function ReceivedGroup({
  group,
  choices,
  wallets,
  expanded,
  expandHref,
}: {
  group: ReviewGroup;
  choices: Choices;
  wallets: readonly Wallet[];
  expanded: boolean;
  expandHref: string;
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
      <ul aria-label={`Recebidos sem par: ${title}`} className="divide-y border-t md:border-t-0">
        {shown.map((item) => (
          <ReceivedRow key={item.id} item={item} choices={choices} wallets={wallets} />
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
