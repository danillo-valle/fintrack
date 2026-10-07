"use client";

import { Send } from "lucide-react";
import { ActionForm } from "@/components/feedback/action-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { HOUSEHOLD_ROLE_LABEL } from "@/lib/access-messages";
import { createInviteAction, type InviteState } from "../server/actions";
import { CopyLink } from "./copy-link";

const initial: InviteState = { error: null, success: null, link: null };

// Convidar alguém para o lar: e-mail e papel. O link volta UMA vez para copiar.
export function InviteForm() {
  return (
    <ActionForm
      action={createInviteAction}
      initialState={initial}
      idPrefix="convite-"
      className="flex flex-col gap-4"
      aria-label="Convidar para o lar"
    >
      {({ pending, field, state }) => {
        const email = field("email");
        return (
          <>
            <Field data-invalid={email.error ? true : undefined}>
              <FieldLabel htmlFor="invite-email">E-mail de quem você quer convidar</FieldLabel>
              <Input
                id="invite-email"
                name="email"
                type="email"
                required
                autoComplete="off"
                inputMode="email"
                data-msg-missing="Digite o e-mail de quem você quer convidar."
                {...email.props}
              />
              <FieldError id={email.errorId}>{email.error}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="invite-role">Papel no lar</FieldLabel>
              <NativeSelect
                id="invite-role"
                name="role"
                defaultValue="MEMBER"
                className="self-start"
              >
                <option value="MEMBER">
                  {HOUSEHOLD_ROLE_LABEL.MEMBER} (cria carteiras e participa)
                </option>
                <option value="OWNER">
                  {HOUSEHOLD_ROLE_LABEL.OWNER} (também convida e remove)
                </option>
              </NativeSelect>
            </Field>
            <Button type="submit" className="self-start" disabled={pending}>
              <Send aria-hidden />
              {pending ? "Enviando…" : "Enviar convite"}
            </Button>
            {state.link ? <CopyLink link={state.link} /> : null}
          </>
        );
      }}
    </ActionForm>
  );
}
