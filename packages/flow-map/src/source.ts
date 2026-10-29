// O código do FinTrack visto como texto: lê e analisa cada arquivo uma vez (só a sintaxe, sem o
// verificador de tipos, para ser rápido e não depender do build) e resolve os imports do mesmo
// jeito que o app: "@/..." é apps/web/src, "@fintrack/<pacote>" segue o "exports" do pacote.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export type Resolved = { file: string } | { external: string };

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

export class Source {
  readonly root: string;
  readonly webSrc: string;
  private readonly cache = new Map<string, ts.SourceFile>();
  private readonly packages = new Map<string, Record<string, string>>();

  constructor(root: string) {
    this.root = root;
    this.webSrc = path.join(root, "apps/web/src");
  }

  /** O caminho relativo à raiz do repositório, sempre com "/" (o mapa sai igual em qualquer sistema). */
  rel(file: string): string {
    return path.relative(this.root, file).split(path.sep).join("/");
  }

  parse(file: string): ts.SourceFile {
    let sf = this.cache.get(file);
    if (!sf) {
      const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      sf = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        kind,
      );
      this.cache.set(file, sf);
    }
    return sf;
  }

  /** A diretiva do topo do arquivo ("use client", "use server") ou null. */
  directive(file: string): string | null {
    const first = this.parse(file).statements[0];
    if (first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression)) {
      return first.expression.text;
    }
    return null;
  }

  resolve(from: string, spec: string): Resolved {
    let base: string | null = null;
    if (spec.startsWith("@/")) base = path.join(this.webSrc, spec.slice(2));
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
    else if (spec.startsWith("@fintrack/")) {
      const target = this.packageExport(spec);
      if (target) return { file: target };
    }
    if (base) {
      for (const candidate of [base, ...EXTENSIONS.map((ext) => base + ext)]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return { file: candidate };
      }
    }
    return { external: spec };
  }

  /** "@fintrack/importers/testing" → o arquivo que o "exports" do pacote aponta. */
  private packageExport(spec: string): string | null {
    const [, name, ...rest] = spec.split("/");
    if (!name) return null;
    const dir = path.join(this.root, "packages", name);
    let exports = this.packages.get(dir);
    if (!exports) {
      const manifest = path.join(dir, "package.json");
      if (!existsSync(manifest)) return null;
      const json = JSON.parse(readFileSync(manifest, "utf8")) as {
        exports?: Record<string, string>;
      };
      exports = json.exports ?? {};
      this.packages.set(dir, exports);
    }
    const key = rest.length === 0 ? "." : `./${rest.join("/")}`;
    const target = exports[key];
    return target ? path.join(dir, target) : null;
  }
}
