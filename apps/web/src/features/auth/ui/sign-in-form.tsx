"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fingerprint, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage, isCancelled } from "@/lib/auth/messages";
import { passkeySupport, passkeyUnavailableMessage } from "@/lib/auth/passkey-support";
import { FormAlert } from "./form-alert";
import { PasswordInput } from "./password-input";

type Props = {
  /** Para onde ir depois de entrar (já validado pelo servidor: só caminhos internos) */
  next: string;
  googleEnabled: boolean;
  /** Mensagem vinda de outra tela, como "Senha trocada. Entre com a nova senha." */
  notice?: string | undefined;
};

export function SignInForm({ next, googleEnabled, notice }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Preenchimento automático de passkey ("conditional UI"): se o navegador tiver uma passkey
  // do FinTrack, ela aparece como sugestão no próprio campo de e-mail.
  useEffect(() => {
    if (typeof PublicKeyCredential === "undefined") return;
    void PublicKeyCredential.isConditionalMediationAvailable?.().then((available) => {
      if (!available) return;
      void authClient.signIn.passkey({ autoFill: true }).then((result) => {
        if (!result?.error) {
          router.replace(next);
          router.refresh();
        }
      });
    });
  }, [next, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);

    // Se a conta tem 2FA, o Better Auth não cria a sessão ainda: responde "falta o segundo
    // fator", e o twoFactorClient (auth-client.ts) leva para /entrar/dois-fatores
    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });

    if (error) {
      setPending(false);
      setError(authErrorMessage(error));
      // A senha é apagada e recebe o foco: o próximo passo natural é digitá-la de novo
      if (passwordRef.current) passwordRef.current.value = "";
      passwordRef.current?.focus();
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return;
    router.replace(next);
    router.refresh();
  }

  async function handlePasskey() {
    setError(null);
    // Sem suporte (ex.: celular pelo http da rede de casa), o Better Auth responderia
    // "cancelado" e a tela ficaria muda. Conferir antes permite explicar o motivo.
    const support = passkeySupport();
    if (support !== "ok") {
      setError(passkeyUnavailableMessage(support, "entrar"));
      return;
    }
    const result = await authClient.signIn.passkey();
    if (result?.error) {
      // Cancelar a janela da passkey não é erro: a pessoa só mudou de ideia
      if (!isCancelled(result.error)) setError(authErrorMessage(result.error));
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function handleGoogle() {
    setError(null);
    await authClient.signIn.social({
      provider: "google",
      callbackURL: next,
      errorCallbackURL: "/entrar?erro=google",
    });
  }

  return (
    <>
      <FormAlert message={notice ?? null} variant="success" />
      <FormAlert message={error} />
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">E-mail</FieldLabel>
            {/* "webauthn" no autocomplete liga a sugestão de passkey neste campo */}
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username webauthn"
              required
              className="h-10"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Senha</FieldLabel>
            <PasswordInput
              ref={passwordRef}
              id="password"
              name="password"
              autoComplete="current-password"
              required
            />
            {/* Depois do campo, não antes: o Tab vai do e-mail direto para a senha */}
            <Link
              href="/esqueci-a-senha"
              className="text-primary focus-visible:ring-ring self-start rounded-sm text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3"
            >
              Esqueci a senha
            </Link>
          </Field>
          <Button type="submit" size="lg" className="h-11" disabled={pending}>
            <LogIn aria-hidden />
            {pending ? "Entrando…" : "Entrar"}
          </Button>
          <FieldSeparator>ou</FieldSeparator>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11"
            onClick={handlePasskey}
          >
            <Fingerprint aria-hidden />
            Entrar com passkey
          </Button>
          {googleEnabled ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11"
              onClick={handleGoogle}
            >
              Entrar com Google
            </Button>
          ) : null}
        </FieldGroup>
      </form>
    </>
  );
}
