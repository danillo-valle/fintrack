-- M13.3a (ADR-025): toda compra no cartão de crédito tem fatura, e conta no vencimento dela.
--
-- Uma compra (lançamento de conta de cartão de crédito que não é transferência) sem statementId
-- ganha a fatura pelo gatilho "transaction_card_statement", antes de gravar. Quem grava pode
-- continuar escolhendo a fatura (a do banco, a do PDF): o gatilho só preenche o que veio vazio.
-- A escolha é a de packages/core (statementFor e statementWindow), escrita em SQL; o teste de
-- integração "faturas" confere as duas com dias e ciclos sorteados.

-- 1. O dia `day` de um mês, ou o último dia num mês mais curto (dayOfMonth do core)
CREATE FUNCTION "fintrack_day_of_month"(month_first date, day integer) RETURNS date
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT make_date(
      extract(year FROM month_first)::integer,
      extract(month FROM month_first)::integer,
      LEAST(day, extract(day FROM (date_trunc('month', month_first) + interval '1 month - 1 day'))::integer)
    )
  $$;

-- 2. A fatura de um mês de referência no ciclo (statementOfMonth do core): fecha no dia do
--    fechamento; vence na primeira vez que o dia do vencimento aparece depois do fechamento
CREATE FUNCTION "fintrack_statement_of_month"(
  reference_month date, closing_day integer, due_day integer,
  OUT closing_date date, OUT due_date date
) LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
  same_month_due date;
BEGIN
  closing_date := "fintrack_day_of_month"(reference_month, closing_day);
  same_month_due := "fintrack_day_of_month"(reference_month, due_day);
  IF same_month_due > closing_date THEN
    due_date := same_month_due;
  ELSE
    due_date := "fintrack_day_of_month"((reference_month + interval '1 month')::date, due_day);
  END IF;
END
$$;

-- 3. A fatura de uma compra (devolve o id, criando a fatura aberta do ciclo se preciso):
--    a) a fatura GRAVADA cujo período contém o dia: a primeira que fecha depois dele, se ela
--       começa até ele. O período começa no fechamento da anterior gravada, se ela fechou até 45
--       dias antes (STATEMENT_GAP_DAYS do core); senão, um mês antes do fechamento
--       (statementWindow do core). Assim as datas que o banco mandou valem mais que o ciclo;
--    b) senão, a fatura do ciclo da conta (statementFor do core): antes do fechamento, a do mês;
--       no dia do fechamento ou depois, a do mês seguinte. Criada aberta se ainda não existe
CREATE FUNCTION "fintrack_statement_for"(account uuid, purchased_on date) RETURNS uuid
  LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  next_statement record;
  previous_closing date;
  window_start date;
  cycle record;
  reference_month date;
  dates record;
  found_id uuid;
BEGIN
  SELECT s."id", s."closingDate" INTO next_statement
    FROM "card_statement" s
   WHERE s."accountId" = account AND s."closingDate" > purchased_on
   ORDER BY s."closingDate"
   LIMIT 1;
  IF FOUND THEN
    SELECT max(p."closingDate") INTO previous_closing
      FROM "card_statement" p
     WHERE p."accountId" = account AND p."closingDate" < next_statement."closingDate";
    IF previous_closing IS NOT NULL AND next_statement."closingDate" - previous_closing <= 45 THEN
      window_start := previous_closing;
    ELSE
      window_start := (next_statement."closingDate" - interval '1 month')::date;
    END IF;
    IF purchased_on >= window_start THEN
      RETURN next_statement."id";
    END IF;
  END IF;

  SELECT a."closingDay", a."dueDay" INTO cycle
    FROM "financial_account" a
   WHERE a."id" = account AND a."kind" = 'CREDIT_CARD';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  reference_month := date_trunc('month', purchased_on)::date;
  dates := "fintrack_statement_of_month"(reference_month, cycle."closingDay", cycle."dueDay");
  IF purchased_on >= dates.closing_date THEN
    reference_month := (reference_month + interval '1 month')::date;
    dates := "fintrack_statement_of_month"(reference_month, cycle."closingDay", cycle."dueDay");
  END IF;
  INSERT INTO "card_statement" ("id", "accountId", "referenceMonth", "closingDate", "dueDate", "updatedAt")
  VALUES (gen_random_uuid(), account, reference_month, dates.closing_date, dates.due_date, now())
  ON CONFLICT ("accountId", "referenceMonth") DO NOTHING;
  SELECT s."id" INTO found_id
    FROM "card_statement" s
   WHERE s."accountId" = account AND s."referenceMonth" = reference_month;
  RETURN found_id;
END
$$;

-- 4. O gatilho: compra no cartão sem fatura ganha a fatura do dia. Transferência (o pagamento da
--    fatura que entra no cartão) não é compra e fica sem
CREATE FUNCTION "transaction_card_statement"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."statementId" IS NULL AND NEW."transferId" IS NULL THEN
    NEW."statementId" := "fintrack_statement_for"(NEW."accountId", NEW."occurredOn");
  END IF;
  RETURN NEW;
END
$$;

-- O nome vem antes de "transaction_method_matches_account" na ordem alfabética: o Postgres
-- dispara os gatilhos nessa ordem, e a conferência da forma de pagamento já vê a fatura
CREATE TRIGGER "transaction_card_statement"
  BEFORE INSERT OR UPDATE OF "occurredOn", "accountId", "statementId", "transferId" ON "transaction"
  FOR EACH ROW EXECUTE FUNCTION "transaction_card_statement"();

-- 5. As compras que já existem ganham a fatura pela mesma regra, da mais antiga para a mais nova
--    (assim cada fatura nova criada no caminho já vale para as compras seguintes)
DO $$
DECLARE
  purchase record;
BEGIN
  FOR purchase IN
    SELECT t."id", t."accountId", t."occurredOn"
      FROM "transaction" t
      JOIN "financial_account" a ON a."id" = t."accountId"
     WHERE a."kind" = 'CREDIT_CARD' AND t."statementId" IS NULL AND t."transferId" IS NULL
     ORDER BY t."accountId", t."occurredOn", t."id"
  LOOP
    UPDATE "transaction"
       SET "statementId" = "fintrack_statement_for"(purchase."accountId", purchase."occurredOn")
     WHERE "id" = purchase."id";
  END LOOP;
END
$$;
