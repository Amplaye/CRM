-- Soft delete for conversations: deleting a conversation no longer destroys the
-- row. It is flagged with `deleted_at` and hidden from the inbox, but can be
-- restored from the Trash for 30 days. After that the purge-tenants cron removes
-- it for good. Reservations were already protected (FK on delete set null), so
-- this mainly preserves the chat context for recovery.
alter table public.conversations
  add column if not exists deleted_at timestamptz;

-- Partial index: the inbox always filters `deleted_at is null`, and the Trash
-- view / purge cron scan the (small) set of soft-deleted rows.
create index if not exists idx_conversations_deleted_at
  on public.conversations (deleted_at)
  where deleted_at is not null;
