"use client";

// "O banco mandou compras do final 0009" (M09.2, prancha E2-Finais): cadastra o cartão desse
// final e leva os recebidos dele para o portador e o ambiente certos. Só os 4 últimos dígitos.
import Link from "next/link";
import { Check, TriangleAlert } from "lucide-react";
import { ActionForm } from "@/components/feedback/action-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { registerFinalAction } from "../../server/review-actions";

export function FinalForm({
  accountId,
  lastFour,
  count,
  people,
  defaultHolder,
}: {
  accountId: string;
  lastFour: string;
  count: number;
  people: readonly { userId: string; name: string }[];
  defaultHolder: string;
}) {
  const prefix = `final-${lastFour}-`;
  return (
    <ActionForm
      action={registerFinalAction}
      idPrefix={prefix}
      id={`final-${lastFour}`}
      aria-label={`Cadastrar o cartão final ${lastFour}`}
      className="border-chart-4-ink flex scroll-mt-24 flex-col gap-3 rounded-2xl border-[1.5px] border-dashed bg-[color-mix(in_srgb,var(--chart-4)_14%,transparent)] p-4"
    >
      {({ pending, field }) => {
        const nickname = field("nickname");
        const final = field("lastFour");
        return (
          <>
            <input type="hidden" name="accountId" value={accountId} />
            <div className="flex items-center gap-2">
              <TriangleAlert aria-hidden className="text-chart-4-ink size-5 shrink-0" />
              <h3 className="text-[0.9375rem] font-bold">
                O banco mandou compras do final <span className="tabular">{lastFour}</span>
              </h3>
            </div>
            <p className="text-sm">
              {count === 1 ? "1 recebido está" : `${count} recebidos estão`} sem cartão. Ao
              cadastrar, {count === 1 ? "ele vai" : "eles vão"} na hora para o portador e o ambiente
              certos; o que você já confirmou não muda.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <Field data-invalid={nickname.error ? true : undefined}>
                <FieldLabel htmlFor={`${prefix}apelido`}>Apelido</FieldLabel>
                <Input
                  id={`${prefix}apelido`}
                  name="nickname"
                  required
                  maxLength={60}
                  placeholder="Master virtual"
                  data-msg-missing="Dê um apelido ao cartão."
                  className="h-11"
                  {...nickname.props}
                />
                <FieldError id={nickname.errorId}>{nickname.error}</FieldError>
              </Field>
              <Field data-invalid={final.error ? true : undefined}>
                <FieldLabel htmlFor={`${prefix}final`}>Final</FieldLabel>
                <Input
                  id={`${prefix}final`}
                  name="lastFour"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                  pattern="[0-9]{4}"
                  maxLength={4}
                  defaultValue={lastFour}
                  data-msg-missing="Digite os 4 últimos dígitos."
                  data-msg-pattern="Digite só os 4 últimos dígitos."
                  className="tabular h-11 font-mono"
                  {...final.props}
                />
                <FieldError id={final.errorId}>{final.error}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${prefix}portador`}>Portador</FieldLabel>
                <NativeSelect
                  id={`${prefix}portador`}
                  name="holderId"
                  defaultValue={defaultHolder}
                  className="h-11 rounded-xl"
                >
                  {people.map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-2.5 md:flex md:justify-end">
              <Button
                asChild
                variant="outline"
                className="h-11 rounded-xl px-4 text-sm font-semibold"
              >
                <Link href="/lancamentos/recebidos">Agora não</Link>
              </Button>
              <Button
                type="submit"
                disabled={pending}
                className="h-11 gap-2 rounded-xl px-[1.125rem] text-sm font-bold"
              >
                <Check aria-hidden />
                Cadastrar e reorganizar
              </Button>
            </div>
          </>
        );
      }}
    </ActionForm>
  );
}
