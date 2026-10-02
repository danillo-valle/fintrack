"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";

type Props = Omit<React.ComponentProps<typeof Input>, "type">;

// Campo de senha com botão "Mostrar". Ver o que digitou reduz erro de digitação, que é o que
// o NIST recomenda no lugar de pedir a senha duas vezes.
export function PasswordInput({ className, ...props }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        className={`h-10 pr-24 ${className ?? ""}`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        // Só a troca de nome, sem aria-pressed: os dois juntos fariam o leitor de tela dizer
        // "Esconder a senha, pressionado". O nome contém o texto visível (WCAG 2.5.3).
        aria-label={visible ? "Esconder a senha" : "Mostrar a senha"}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute inset-y-1 right-1 flex items-center gap-1 rounded-md px-2 text-xs font-medium outline-none focus-visible:ring-3"
      >
        {visible ? (
          <EyeOff aria-hidden className="size-4" />
        ) : (
          <Eye aria-hidden className="size-4" />
        )}
        <span aria-hidden>{visible ? "Esconder" : "Mostrar"}</span>
      </button>
    </div>
  );
}
