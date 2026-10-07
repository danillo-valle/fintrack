import * as React from "react";
import { cn } from "cn";

// <select> nativo com a aparência do Input (M06). Nativo de propósito: no celular abre o
// seletor do sistema, funciona com teclado e leitor de tela sem nenhum JavaScript, e o anel
// de foco é o mesmo dos outros campos (foco-visivel.spec.ts exige o anel do tema).
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "border-input focus-visible:border-ring focus-visible:ring-ring aria-invalid:border-destructive dark:bg-input/30 h-8 min-w-0 rounded-lg border bg-transparent px-2 text-base outline-none focus-visible:ring-3 disabled:opacity-50 md:text-sm dark:[color-scheme:dark]",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
