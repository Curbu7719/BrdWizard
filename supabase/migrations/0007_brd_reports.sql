-- ============================================================
-- 0007: User-authored reporting requirements on a BRD
-- ============================================================
-- An optional free-text field the user fills in from the right panel:
--   reports — reporting requirements for this BRD
-- Nullable, defaults to NULL (empty until the user writes something).

alter table public.brd_documents
  add column if not exists reports text;
