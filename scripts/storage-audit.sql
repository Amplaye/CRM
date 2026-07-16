-- ============================================================
-- STORAGE AUDIT — TableFlow / BaliFlow CRM
-- Sola lettura. Incolla tutto nel Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → Run).
-- Mostra dove sta davvero il peso: DB, tabelle, bucket file.
-- ============================================================

-- 1) Dimensione totale del database (confronta con il limite del piano:
--    Free = 500 MB, Pro = 8 GB inclusi)
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_totale;

-- 2) Top 25 tabelle per peso reale (dati + indici + TOAST/JSONB).
--    È QUI che si nasconde l'accumulo dei JSONB (transcript, raw_payload).
SELECT
  c.relname                                              AS tabella,
  pg_size_pretty(pg_total_relation_size(c.oid))          AS peso_totale,
  pg_size_pretty(pg_relation_size(c.oid))                AS solo_dati,
  pg_size_pretty(pg_total_relation_size(c.oid)
                 - pg_relation_size(c.oid))              AS indici_e_toast,
  c.reltuples::bigint                                    AS righe_stimate
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname = 'public'
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 25;

-- 3) Peso dei bucket Supabase Storage (file caricati: foto piatti, loghi, import).
--    Confronta col limite file storage: Free = 1 GB, Pro = 100 GB inclusi.
SELECT
  bucket_id,
  count(*)                                               AS file,
  pg_size_pretty(coalesce(sum((metadata->>'size')::bigint), 0)) AS peso_totale
FROM storage.objects
GROUP BY bucket_id
ORDER BY coalesce(sum((metadata->>'size')::bigint), 0) DESC;

-- 4) Conteggio righe esatto sulle tabelle che crescono nel tempo.
--    Se conversations/pos_sales esplodono, sono i primi candidati al purge.
SELECT 'conversations'        AS tabella, count(*) AS righe FROM conversations
UNION ALL SELECT 'reservations',          count(*) FROM reservations
UNION ALL SELECT 'reservation_events',    count(*) FROM reservation_events
UNION ALL SELECT 'pos_sales',             count(*) FROM pos_sales
UNION ALL SELECT 'pos_sale_items',        count(*) FROM pos_sale_items
UNION ALL SELECT 'system_logs',           count(*) FROM system_logs
UNION ALL SELECT 'audit_events',          count(*) FROM audit_events
UNION ALL SELECT 'webhook_events',        count(*) FROM webhook_events
UNION ALL SELECT 'supplier_invoices',     count(*) FROM supplier_invoices
UNION ALL SELECT 'supplier_invoice_items',count(*) FROM supplier_invoice_items
ORDER BY righe DESC;
