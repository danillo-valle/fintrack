import { describe, expect, it } from "vitest";
import { environmentsOf, environmentsSentence, type Environment } from "./environments";

const casa: Environment = { id: "c", name: "Casa", kind: "SHARED" };
const viagem: Environment = { id: "v", name: "Viagem", kind: "SHARED" };
const bruna: Environment = { id: "b", name: "Bruna Prado", kind: "PERSONAL" };

describe("environmentsOf", () => {
  it("compartilhados primeiro, por nome; arquivados fora", () => {
    expect(
      environmentsOf([
        { ...bruna, archived: false },
        { ...viagem, archived: false },
        { ...casa, archived: false },
        { id: "x", name: "Antigo", kind: "SHARED", archived: true },
      ]),
    ).toEqual([casa, viagem, bruna]);
  });
});

describe("environmentsSentence", () => {
  it("diz o que soma e de quem é o pessoal que fica de fora", () => {
    expect(environmentsSentence([casa, bruna], null, ["Caio"])).toBe(
      "Somando os ambientes Casa e Bruna Prado. O ambiente pessoal de Caio não entra aqui.",
    );
    expect(environmentsSentence([casa, bruna], null, ["Caio", "Ana"])).toBe(
      "Somando os ambientes Casa e Bruna Prado. Os ambientes pessoais de Caio e Ana não entram aqui.",
    );
  });

  it("sem outras pessoas, só o que soma", () => {
    expect(environmentsSentence([casa, bruna], null, [])).toBe(
      "Somando os ambientes Casa e Bruna Prado.",
    );
  });

  it("nada a dizer com um ambiente escolhido ou com um só", () => {
    expect(environmentsSentence([casa, bruna], "c", ["Caio"])).toBeNull();
    expect(environmentsSentence([bruna], null, [])).toBeNull();
  });
});
