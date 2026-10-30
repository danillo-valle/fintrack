-- M12.4 (ADR-024): a auditoria continua só de acréscimo, com UMA saída: o TRUNCATE feito pelo
-- fintrack-zerar (deploy/sql/zerar.sql), que liga a marca fintrack.zerar com SET LOCAL só dentro
-- da própria transação. UPDATE e DELETE continuam recusados sempre; um TRUNCATE sem a marca
-- também. Os dois gatilhos da migração do domínio (M04) continuam os mesmos: muda só a função.
--
-- Não protege contra quem administra o banco (que já podia desligar o gatilho): protege, como
-- antes, contra um bug do app e contra uma consulta digitada à mão por engano.
CREATE OR REPLACE FUNCTION "audit_log_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' AND current_setting('fintrack.zerar', true) = 'sim' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'audit_log só aceita INSERT (tentativa de %)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
