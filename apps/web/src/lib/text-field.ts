import { cleanText } from "@fintrack/core";
import { z } from "zod";

/**
 * Um campo de texto livre de formulário (nome, descrição, observação, apelido...): o texto é limpo
 * (cleanText do @fintrack/core, M12.4a) ANTES do `.trim()`, do `.min()` e do `.max()` que cada
 * schema encadeia. Sem isso, um caractere nulo virava erro 500 no banco e um invisível passava
 * pelas conferências.
 *
 *   name: textField().trim().min(1, "Dê um nome.").max(60)
 *
 * Campo com formato fixo (id, data, valor, código) não precisa: o `.regex()`, o `.pipe()` ou o
 * `z.uuid()` já recusam qualquer caractere fora do formato. O teste `schemas-text.test.ts` confere
 * que todo `z.string()` dos schemas tem um ou outro.
 */
export const textField = () => z.string().overwrite(cleanText);
