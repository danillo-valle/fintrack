// Cliente único do banco de dados (Prisma ORM 7 + driver adapter do PostgreSQL).
//
// Por que um cliente só: cada PrismaClient abre o próprio pool de conexões. No `pnpm dev`,
// o Next.js recarrega os módulos a cada arquivo salvo; sem o truque do globalThis abaixo,
// cada recarga criaria um pool novo e o Postgres esgotaria as conexões em poucos minutos.
//
// Quem pode importar este pacote: só src/lib e src/features/*/server (regra do ESLint do M01).
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não definida. Confira o arquivo .env na raiz do repositório.");
  }
  // O driver adapter usa o driver "pg" (node-postgres) para falar com o banco,
  // no lugar do motor em Rust das versões anteriores do Prisma.
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type { PrismaClient } from "./generated/prisma/client";
// O namespace Prisma (Prisma.Decimal, tipos de entrada) e os enums do schema (WalletKind...)
export { Prisma } from "./generated/prisma/client";
export * from "./generated/prisma/enums";

// Os tipos dos modelos, para as features importarem daqui e não do código gerado
export type {
  AuditLog,
  Budget,
  CardStatement,
  Category,
  CategoryRule,
  CategorizationExample,
  FinancialAccount,
  Household,
  HouseholdInvite,
  HouseholdMember,
  InstallmentGroup,
  PaymentCard,
  ProviderConnection,
  Recurrence,
  SyncRun,
  Transaction,
  User,
  Wallet,
  WalletMember,
} from "./generated/prisma/client";

// Dinheiro: a ponte entre Prisma.Decimal (banco) e bigint em centavos (@fintrack/core)
export { fromDbDecimal, fromDbDecimalOrNull, toDbDecimal } from "./money";

// Autorização por recurso e operações do lar e das carteiras (M06). Toda operação que muda
// dados exige o "crachá" devolvido por authorizeWallet/authorizeHousehold (veja access.ts).
export * from "./access";
export { maskEmail, type AuditAction, type RequestContext } from "./audit";
export * from "./households";
export * from "./wallets";

// Lançamentos, contas, categorias e recorrências (M07). Mesma regra: crachá antes de tudo.
export * from "./accounts";
export * from "./categories";
export * from "./recurrences";
export * from "./transactions";
export * from "./installments";
