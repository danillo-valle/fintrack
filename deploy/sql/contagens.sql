-- Quantas linhas tem cada tabela do schema public, uma por linha ("tabela quantidade"), em ordem.
-- O fintrack-backup grava isto ao lado de cada backup (o "manifesto", cifrado como o backup) e o
-- fintrack-restore-test --completo confere o banco restaurado contra ele, tabela a tabela
-- (M12.4, ADR-024). Só números: nenhum dado sai daqui.
SELECT tablename || ' ' || (xpath('/row/n/text()', query_to_xml(
         format('SELECT count(*) AS n FROM public.%I', tablename), false, true, '')))[1]::text
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
