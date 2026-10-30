-- Zerar o FinTrack para começar com dados reais (M12.4, ADR-024): apaga TODOS os dados do app e
-- mantém só os logins. Quem roda é o deploy/bin/fintrack-zerar (que faz o backup antes e para o
-- app); o teste de integração packages/db/src/integration/zerar.integration.test.ts roda este
-- mesmo arquivo num banco temporário.
--
-- Fica (as pessoas continuam entrando como antes):
--   user, account (a senha e o Google), twoFactor, passkey, session, jwks (a chave dos tokens
--   do serviço Python) e _prisma_migrations.
-- Sai, sem exceção: tudo o mais do schema public, inclusive a auditoria (decisão de 29/10) e
-- tabelas que vierem depois (a lista é do que FICA; tabela nova sai sem precisar mexer aqui).
-- Da fila (pgboss) saem os trabalhos pendentes; os horários fixos (schedule) ficam.
--
-- Tudo numa transação: ou apaga tudo, ou nada. A auditoria só aceita o TRUNCATE com a marca
-- fintrack.zerar ligada nesta transação (SET LOCAL some no fim dela); UPDATE e DELETE continuam
-- recusados sempre (migração *_zerar_auditoria).
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL fintrack.zerar = 'sim';

DO $$
DECLARE
  keep CONSTANT text[] := ARRAY[
    '_prisma_migrations', 'user', 'account', 'twoFactor', 'passkey', 'session', 'jwks'
  ];
  missing text;
  targets text;
  t text;
  has_rows boolean;
BEGIN
  -- As tabelas que ficam precisam existir: um nome trocado aqui apagaria os logins
  SELECT string_agg(k, ', ') INTO missing
  FROM unnest(keep) AS k
  WHERE to_regclass(format('public.%I', k)) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'zerar: tabelas que deviam ficar não existem: %', missing;
  END IF;

  SELECT string_agg(format('public.%I', tablename), ', ' ORDER BY tablename) INTO targets
  FROM pg_tables
  WHERE schemaname = 'public' AND NOT (tablename = ANY (keep));

  -- Sem CASCADE: se uma tabela que fica apontasse para uma que sai, o TRUNCATE recusaria em vez
  -- de apagar a que fica junto
  EXECUTE 'TRUNCATE ' || targets || ' RESTART IDENTITY';

  -- Os trabalhos que a fila ainda faria apontam para dados que não existem mais
  IF to_regclass('pgboss.job') IS NOT NULL THEN
    TRUNCATE pgboss.job;
  END IF;
  IF to_regclass('pgboss.job_dependency') IS NOT NULL THEN
    TRUNCATE pgboss.job_dependency;
  END IF;

  -- A conferência, ainda dentro da transação: sobrou linha fora dos logins? Desfaz tudo
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND NOT (tablename = ANY (keep))
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', t) INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION 'zerar: a tabela % ainda tem dados', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'zerar: só os logins ficaram';
END
$$;

COMMIT;
