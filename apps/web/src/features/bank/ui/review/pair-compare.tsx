// "Confirmar o par" (M09.2, pranchas E2-Par e E2-CelPar): o que fica de cada lado. Fica UM
// lançamento, confirmado: a descrição, a categoria e o ambiente são os seus; a data e o valor,
// os do banco.
//
//   computador  tabela: campo | Seu lançamento | Do banco | Resultado ("fica a sua")
//   celular     lista:  campo, o valor que fica e a etiqueta
import { Check, Info } from "lucide-react";
import type { PairPreview } from "../../server/review";
import { formatBRL } from "@/lib/money";
import { ToneChip } from "@/components/visual/tone-chip";
import { dayMonth } from "./parts";

type Line = {
  label: string;
  mine: string;
  bank: string;
  /** "a sua", "a do banco", "o seu"; null = igual nos dois */
  keeps: string | null;
  /** O valor que fica (o celular mostra só ele) */
  result: string;
  numeric?: boolean;
};

const signed = (cents: bigint) =>
  `${cents < 0n ? "− " : "+ "}${formatBRL(cents < 0n ? -cents : cents)}`;

export function pairLines(preview: PairPreview): Line[] {
  const { own, received, result } = preview;
  const bankCard = received.card
    ? `final ${received.card.lastFour}`
    : received.unknownLastFour
      ? `final ${received.unknownLastFour}`
      : "—";
  const ownCard = own.cardLastFour ? `${received.account.name} final ${own.cardLastFour}` : "—";
  const sameDate = own.occurredOn === received.occurredOn;
  const bankWallet =
    received.wallet.id === result.walletId
      ? received.wallet.name
      : `${received.wallet.name} (padrão do cartão)`;
  return [
    {
      label: "Descrição",
      mine: own.description,
      bank: received.description,
      keeps: own.description === received.description ? null : "a sua",
      result: own.description,
    },
    {
      label: "Data",
      mine: dayMonth(own.occurredOn),
      bank: dayMonth(received.occurredOn),
      keeps: sameDate ? null : "a do banco",
      result: dayMonth(received.occurredOn),
      numeric: true,
    },
    {
      label: "Valor",
      mine: signed(own.amount),
      bank: signed(received.amount),
      keeps: null,
      result: signed(received.amount),
      numeric: true,
    },
    {
      label: "Categoria",
      mine: own.category?.name ?? "—",
      bank: received.category?.name ?? "—",
      keeps:
        own.category?.id === received.category?.id ? null : own.category ? "a sua" : "a do banco",
      result: (own.category ?? received.category)?.name ?? "Sem categoria",
    },
    {
      label: "Ambiente",
      mine: own.wallet.name,
      bank: bankWallet,
      keeps: own.wallet.id === received.wallet.id ? null : "o seu",
      result: own.wallet.name,
    },
    {
      label: "Cartão",
      mine: ownCard,
      bank: bankCard,
      keeps: null,
      result: received.card ? bankCard : ownCard,
    },
  ];
}

function Keeps({ keeps }: { keeps: string | null }) {
  if (!keeps) return <span className="text-muted-foreground text-[0.8125rem]">igual</span>;
  return (
    <ToneChip tone={5} icon={Check}>
      fica {keeps}
    </ToneChip>
  );
}

export function PairCompare({ preview }: { preview: PairPreview }) {
  const lines = pairLines(preview).filter(
    (l) => l.label !== "Cartão" || l.mine !== "—" || l.bank !== "—",
  );
  return (
    <div className="flex flex-col gap-3.5">
      <p className="text-[0.9375rem]">
        O mesmo gasto, lançado por você e mandado pelo banco. Fica <strong>um lançamento só</strong>
        , confirmado
        <span className="hidden md:inline">, com o que vale de cada lado</span>:
      </p>
      <table className="hidden w-full border-collapse text-sm md:table">
        <thead>
          <tr className="text-muted-foreground text-left text-xs">
            <td />
            <th scope="col" className="px-2 py-1.5 font-semibold">
              Seu lançamento
            </th>
            <th scope="col" className="px-2 py-1.5 font-semibold">
              Do banco
            </th>
            <th scope="col" className="px-2 py-1.5 font-semibold">
              Resultado
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.label} className="border-t">
              <th
                scope="row"
                className="text-muted-foreground px-2 py-2.5 text-left text-[0.8125rem] font-semibold"
              >
                {l.label}
              </th>
              <td className={l.numeric ? "tabular px-2 py-2.5 font-mono" : "px-2 py-2.5"}>
                {l.mine}
              </td>
              <td className={l.numeric ? "tabular px-2 py-2.5 font-mono" : "px-2 py-2.5"}>
                {l.bank}
              </td>
              <td className="px-2 py-2.5">
                <Keeps keeps={l.keeps} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="md:hidden" aria-label="O que fica">
        {lines
          .filter((l) => l.label !== "Cartão")
          .map((l) => (
            <li
              key={l.label}
              className="grid grid-cols-[5.625rem_minmax(0,1fr)] gap-x-2.5 gap-y-1 border-t py-2.5"
            >
              <span className="text-muted-foreground text-[0.8125rem]">{l.label}</span>
              <span
                className={
                  l.numeric ? "tabular font-mono font-semibold" : "font-semibold break-words"
                }
              >
                {l.result}
              </span>
              <span />
              <span>
                {l.keeps ? (
                  <Keeps keeps={l.keeps} />
                ) : (
                  <span className="text-muted-foreground text-xs">igual nos dois</span>
                )}
              </span>
            </li>
          ))}
      </ul>
      <div className="bg-muted/60 hidden grid-cols-[1.375rem_minmax(0,1fr)] gap-2.5 rounded-[0.875rem] border p-3 md:grid">
        <Info aria-hidden className="text-chart-1-ink size-[1.375rem]" />
        <p className="text-sm">
          O lançamento guarda o id do banco: buscar de novo não cria outro. Errou? “Desfazer” no
          aviso devolve os dois como estavam.
        </p>
      </div>
      <p className="text-muted-foreground text-[0.8125rem] md:hidden">
        Buscar de novo não cria outro. “Desfazer” no aviso devolve os dois.
      </p>
    </div>
  );
}
