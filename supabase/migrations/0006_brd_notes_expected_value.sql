-- ============================================================
-- 0006: User-authored free-text fields on a BRD
-- ============================================================
-- Two optional fields the user fills in directly from the right panel:
--   expected_value — the expected business value / outcome of the BRD
--   notes          — any free-form notes the user wants to attach
-- Both are nullable and default to NULL (empty until the user writes something).

alter table public.brd_documents
  add column if not exists expected_value text,
  add column if not exists notes text;
