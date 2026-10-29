import path from "node:path";

/** A pasta do pacote e a do site montado (dist/site, o que o CI publica). */
export const PACKAGE_DIR = path.resolve(import.meta.dirname, "../..");
export const OUT_DIR = path.join(PACKAGE_DIR, "dist/site");
