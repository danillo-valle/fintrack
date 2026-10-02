// Mensagens de erro de formulário em português, a partir dos atributos que o campo já tem
// (required, type="email", minLength, maxLength, pattern).
//
// Por quê: a validação nativa do navegador mostra a mensagem num balão fora da página, no idioma
// do navegador ("Please fill out this field."), e não marca o campo com aria-invalid. Os
// formulários usam noValidate e chamam esta função; a mensagem aparece embaixo do campo, ligada
// a ele por aria-describedby (o padrão do "Novo lançamento" do M02).
//
// Mensagens específicas de um campo vêm de atributos data-*:
//   data-msg-missing  quando está vazio        data-msg-pattern  quando não segue o pattern
//   data-msg-type     quando o e-mail é inválido

/** O mínimo de um <input> que a função lê. Facilita testar sem navegador. */
export type InputLike = {
  type: string;
  value: string;
  required: boolean;
  minLength: number; // -1 quando não definido (padrão do DOM)
  maxLength: number; // -1 quando não definido
  pattern: string;
  dataset: { msgMissing?: string; msgPattern?: string; msgType?: string };
  labels?: ArrayLike<{ textContent: string | null }> | null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function labelOf(input: InputLike): string {
  return input.labels?.[0]?.textContent?.trim() ?? "";
}

/** A mensagem do primeiro problema do campo, ou null se ele está válido. */
export function messageFor(input: InputLike): string | null {
  const value = input.value;
  const label = labelOf(input);

  if (input.required && value.trim() === "") {
    return (
      input.dataset.msgMissing ?? (label ? `Preencha o campo ${label}.` : "Preencha este campo.")
    );
  }
  if (value === "") return null; // campo opcional e vazio: nada a conferir

  if (input.type === "email" && !EMAIL.test(value.trim())) {
    return input.dataset.msgType ?? "Digite um e-mail válido, como nome@exemplo.com.";
  }
  if (input.minLength > 0 && value.length < input.minLength) {
    return `Use pelo menos ${input.minLength} caracteres.`;
  }
  if (input.maxLength > 0 && value.length > input.maxLength) {
    return `Use no máximo ${input.maxLength} caracteres.`;
  }
  // O pattern do HTML vale para o valor inteiro: ^(?:...)$
  if (input.pattern && !new RegExp(`^(?:${input.pattern})$`, "v").test(value)) {
    return input.dataset.msgPattern ?? "Confira o formato deste campo.";
  }
  return null;
}

/** Campos que entram na conferência: inputs com nome, que não são escondidos nem caixas. */
export function isCheckable(el: Element): el is HTMLInputElement {
  return (
    el instanceof HTMLInputElement &&
    el.name !== "" &&
    !el.disabled &&
    !["hidden", "checkbox", "radio", "submit", "button"].includes(el.type)
  );
}
