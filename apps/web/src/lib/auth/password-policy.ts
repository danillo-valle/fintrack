// Política de senha (NIST SP 800-63B-4, senha usada junto com um segundo fator).
// Fica num arquivo próprio porque o servidor (auth.ts) e os formulários usam os mesmos números.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
