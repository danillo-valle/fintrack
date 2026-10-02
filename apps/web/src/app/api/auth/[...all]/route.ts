// Todos os endpoints do Better Auth (/api/auth/sign-in/email, /api/auth/two-factor/...)
// passam por esta única rota. [...all] captura qualquer caminho depois de /api/auth/.
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const { GET, POST } = toNextJsHandler(auth);
