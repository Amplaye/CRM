-- Cassa: persistenza documento fiscale emesso dal Registratore Telematico (RT).
--
-- Il "momento del denaro" (fn_cassa_pay_atomic) resta invariato: la vendita è
-- già registrata a DB. Dopo la stampa RT riuscita nel browser, l'app salva qui
-- numero/data/matricola del documento commerciale legale.
--
-- Idempotente (pattern add column if not exists). Applicabile più volte.

alter table public.cassa_orders
  add column if not exists rt_doc_number text,
  add column if not exists rt_doc_date timestamptz,
  add column if not exists rt_serial text,
  add column if not exists rt_status text;

-- rt_status: 'emitted' (RT ha stampato il documento commerciale)
--          | 'pending' (RT irraggiungibile all'incasso, da ristampare)
--          | 'skipped' (nessun RT configurato)
comment on column public.cassa_orders.rt_status is
  'Stato emissione documento commerciale RT: emitted | pending | skipped';
