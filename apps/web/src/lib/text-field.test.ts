import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { textField } from "./text-field";

describe("textField", () => {
  it("limpa antes de aparar e de contar (M12.4a)", () => {
    const schema = textField().trim().min(1).max(5);
    expect(schema.parse(" a\u0000b\u200bc ")).toBe("abc");
    expect(schema.safeParse("\u0000\u200b").success).toBe(false);
    // O que o max conta é o texto limpo: 5 letras com invisíveis no meio cabem
    expect(schema.parse("a\u200bb\u200bc\u200bd\u200be")).toBe("abcde");
  });
});

// A lista do que fica de fora: texto que nunca vai ao banco como está (a senha vai para o hash do
// Better Auth; o segredo da Pluggy é cifrado; o "next" passa pelo safeNextPath)
const RAW_ALLOWED = ["password:", "clientSecret:", "next:"];
// Um formato fixo recusa qualquer caractere fora dele
const FORMAT = /\.(regex|pipe)\(|\.refine\(\(v\) => isCivilDate\(v\)/;

/** A cadeia do z.string(): o resto da linha e as linhas seguintes que começam com "." */
function chainAfter(source: string, from: number): string {
  const [first = "", ...rest] = source.slice(from).split("\n");
  const chain = [first];
  for (const line of rest) {
    if (!line.trim().startsWith(".")) break;
    chain.push(line);
  }
  return chain.join("\n");
}

describe("todo texto livre dos formulários passa pelo textField (M12.4a)", () => {
  const featuresDir = path.join(__dirname, "..", "features");
  const files = readdirSync(featuresDir)
    .map((feature) => path.join(featuresDir, feature, "schemas.ts"))
    .filter((file) => {
      try {
        readFileSync(file);
        return true;
      } catch {
        return false;
      }
    });

  it("acha os schemas", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files.map((file) => [path.relative(featuresDir, file), file]))("%s", (_, file) => {
    const source = readFileSync(file, "utf8");
    const bare: string[] = [];
    for (const match of source.matchAll(/\bz\s*\.string\(\)/g)) {
      const before = source.slice(Math.max(0, match.index - 40), match.index);
      const after = chainAfter(source, match.index + match[0].length);
      if (RAW_ALLOWED.some((name) => before.includes(name))) continue;
      if (FORMAT.test(after)) continue;
      const line = source.slice(0, match.index).split("\n").length;
      bare.push(`linha ${line}: use textField() ou um formato (.regex/.pipe)`);
    }
    expect(bare).toEqual([]);
  });
});
