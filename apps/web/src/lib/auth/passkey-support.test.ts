import { describe, expect, it } from "vitest";
import { passkeySupport, passkeyUnavailableMessage } from "./passkey-support";

describe("passkeySupport", () => {
  it("https ou localhost com WebAuthn: ok", () => {
    expect(passkeySupport({ isSecureContext: true, hasWebAuthn: true })).toBe("ok");
  });

  it("http pela rede de casa (192.168.1.92): endereço inseguro", () => {
    // O navegador também esconde a API nesse caso; o motivo que importa é o endereço
    expect(passkeySupport({ isSecureContext: false, hasWebAuthn: false })).toBe("insecure");
  });

  it("endereço seguro, mas navegador sem WebAuthn: sem suporte", () => {
    expect(passkeySupport({ isSecureContext: true, hasWebAuthn: false })).toBe("unsupported");
  });
});

describe("passkeyUnavailableMessage", () => {
  it("ao entrar, sempre oferece o caminho por senha e código", () => {
    expect(passkeyUnavailableMessage("insecure", "entrar")).toMatch(/https.*localhost/);
    expect(passkeyUnavailableMessage("insecure", "entrar")).toMatch(/senha e o código/);
    expect(passkeyUnavailableMessage("unsupported", "entrar")).toMatch(/senha e o código/);
  });

  it("ao adicionar, diz onde dá para fazer", () => {
    expect(passkeyUnavailableMessage("insecure", "adicionar")).toMatch(/https.*localhost/);
    expect(passkeyUnavailableMessage("unsupported", "adicionar")).toMatch(/outro aparelho/);
  });
});
