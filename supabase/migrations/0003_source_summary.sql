-- ============================================================
-- BRD Wizard — Source Document Summary
-- Migration: 0003_source_summary.sql
-- Adds a nullable source_summary column to brd_documents.
-- The column stores the consolidated reference summary returned
-- by /analyze-document so context-builder.ts can inject it as
-- read-only context during epic and user-story generation.
-- RLS policies are inherited from the existing brd_documents policies
-- (owner read/write, admin full access) — no new policies needed.
-- ============================================================

alter table public.brd_documents
  add column if not exists source_summary text;
