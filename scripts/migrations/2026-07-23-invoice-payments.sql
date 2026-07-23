-- Invoice register + scadenzario (accounts-payable lifecycle).
-- Adds the two columns that turn the supplier_invoices table (already the store
-- for OCR'd/confirmed invoices) into a payables register: when a bill is DUE and
-- when it was PAID. Everything else the /invoices page needs (supplier, totals,
-- goods/service split, status parsed/confirmed) already exists.
--
-- Payment state is DERIVED in the app, not stored: paid = paid_at is not null;
-- overdue = due_date < today AND paid_at is null; else pending. So no status
-- column to keep in sync.
--
-- Idempotent: safe to re-paste into the Supabase SQL editor.

alter table public.supplier_invoices
  add column if not exists due_date date,   -- scadenza pagamento
  add column if not exists paid_at  date;   -- data pagamento (null = non pagata)

-- Filtering the payables list by "what's due / overdue / paid".
create index if not exists idx_supplier_invoices_tenant_due
  on public.supplier_invoices(tenant_id, due_date)
  where paid_at is null;
