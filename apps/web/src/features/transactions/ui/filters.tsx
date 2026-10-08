// Filtros da lista (M07): um formulário GET comum. Os filtros vão para a URL (dá para salvar,
// compartilhar com quem também vê a carteira e voltar com o botão do navegador) e funcionam
// sem JavaScript. Componente do servidor.
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { TEXT_LINK } from "@/lib/styles";
import type { ParsedFilters } from "../schemas";

type Option = { id: string; name: string };

const TYPE_PARAM = { expense: "despesa", income: "receita", transfer: "transferencia" } as const;

export function TransactionFilters({
  parsed,
  options,
}: {
  parsed: ParsedFilters;
  options: { wallets: Option[]; accounts: Option[]; categories: Option[] };
}) {
  const f = parsed.filters;
  const active = [parsed.walletId, f.accountId, f.categoryId, f.text, f.type].filter(
    Boolean,
  ).length;

  return (
    <details className="bg-card mb-6 rounded-xl border px-4 py-3" open={active > 0}>
      <summary className="focus-visible:ring-ring flex cursor-pointer items-center gap-2 rounded text-sm font-medium outline-none focus-visible:ring-3">
        <SlidersHorizontal aria-hidden className="size-4" />
        Filtros{active > 0 ? ` (${active} ${active === 1 ? "ativo" : "ativos"})` : ""}
      </summary>
      <form
        method="get"
        action="/lancamentos"
        role="search"
        aria-label="Filtrar lançamentos"
        className="mt-4 grid gap-4 sm:grid-cols-2"
      >
        <Field>
          <FieldLabel htmlFor="f-de">De</FieldLabel>
          <Input id="f-de" name="de" type="date" defaultValue={f.from} className="h-10" />
        </Field>
        <Field>
          <FieldLabel htmlFor="f-ate">Até</FieldLabel>
          <Input id="f-ate" name="ate" type="date" defaultValue={f.to} className="h-10" />
        </Field>
        <Field>
          <FieldLabel htmlFor="f-carteira">Carteira</FieldLabel>
          <NativeSelect
            id="f-carteira"
            name="carteira"
            defaultValue={parsed.walletId ?? ""}
            className="h-10"
          >
            <option value="">Todas que você vê</option>
            {options.wallets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="f-conta">Conta</FieldLabel>
          <NativeSelect id="f-conta" name="conta" defaultValue={f.accountId ?? ""} className="h-10">
            <option value="">Todas</option>
            {options.accounts.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="f-categoria">Categoria</FieldLabel>
          <NativeSelect
            id="f-categoria"
            name="categoria"
            defaultValue={f.categoryId === "none" ? "sem" : (f.categoryId ?? "")}
            className="h-10"
          >
            <option value="">Todas</option>
            <option value="sem">Sem categoria</option>
            {options.categories.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="f-tipo">Tipo</FieldLabel>
          <NativeSelect
            id="f-tipo"
            name="tipo"
            defaultValue={f.type ? TYPE_PARAM[f.type] : ""}
            className="h-10"
          >
            <option value="">Todos</option>
            <option value="despesa">Despesas</option>
            <option value="receita">Receitas</option>
            <option value="transferencia">Transferências</option>
          </NativeSelect>
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="f-q">Texto na descrição ou observação</FieldLabel>
          <Input
            id="f-q"
            name="q"
            type="search"
            maxLength={100}
            defaultValue={f.text ?? ""}
            className="h-10"
          />
        </Field>
        <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
          <Button type="submit">Filtrar</Button>
          <Link href="/lancamentos" className={TEXT_LINK}>
            Limpar filtros
          </Link>
        </div>
      </form>
    </details>
  );
}
