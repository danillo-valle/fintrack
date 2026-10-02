// O navegador oferece passkeys aqui? Conferido ANTES de chamar o Better Auth.
//
// Por quê: sem suporte, o cliente de passkey do Better Auth devolve o código AUTH_CANCELLED,
// o mesmo de quando a pessoa fecha a janela da digital. A tela trata esse código como
// "mudou de ideia" e fica em silêncio. Para quem está no celular pelo http://192.168.1.92:3000,
// parecia um botão quebrado. Com esta checagem, a tela diz o motivo e o que fazer.
//
// As duas condições do navegador:
// - contexto seguro: https, ou http só em localhost/127.0.0.1 (regra do WebAuthn);
// - a API PublicKeyCredential existe (navegadores muito antigos ou modos restritos não têm).

export type PasskeySupport = "ok" | "insecure" | "unsupported";

type BrowserFacts = { isSecureContext: boolean; hasWebAuthn: boolean };

/** Lê os fatos do navegador atual. Fora do navegador (servidor), responde "unsupported". */
function currentBrowser(): BrowserFacts {
  if (typeof window === "undefined") return { isSecureContext: false, hasWebAuthn: false };
  return {
    isSecureContext: window.isSecureContext,
    hasWebAuthn: typeof window.PublicKeyCredential !== "undefined",
  };
}

/** "ok" se dá para usar passkey; senão, o motivo. Os fatos podem ser passados nos testes. */
export function passkeySupport(facts: BrowserFacts = currentBrowser()): PasskeySupport {
  // Endereço inseguro vem primeiro: nesse caso o navegador esconde a API, e o motivo real é o endereço
  if (!facts.isSecureContext) return "insecure";
  if (!facts.hasWebAuthn) return "unsupported";
  return "ok";
}

const FALLBACK = "Entre com e-mail, senha e o código do app autenticador.";

/** Texto para a tela quando a passkey não está disponível. */
export function passkeyUnavailableMessage(
  support: Exclude<PasskeySupport, "ok">,
  action: "entrar" | "adicionar",
): string {
  if (support === "insecure") {
    const what =
      action === "entrar"
        ? `Passkey só funciona em endereço seguro (https) ou pelo localhost. ${FALLBACK}`
        : "Para adicionar uma passkey, abra o FinTrack em endereço seguro (https) ou pelo localhost.";
    return what;
  }
  return action === "entrar"
    ? `Este navegador não oferece passkeys. ${FALLBACK}`
    : "Este navegador não oferece passkeys. Adicione pelo navegador de outro aparelho.";
}
