-- ============================================================
-- 0009: BRD generation audit log (for the admin report)
-- ============================================================
-- One row each time a user generates (exports) a BRD .docx, capturing who
-- generated it, the BRD name at that moment, and the readiness score shown.

create table if not exists public.brd_generations (
  id          uuid primary key default uuid_generate_v4(),
  brd_id      uuid references public.brd_documents(id) on delete set null,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  score       integer,                       -- 0-100 readiness score at generation time
  created_at  timestamptz not null default now()
);

create index if not exists idx_brd_generations_user on public.brd_generations(user_id);
create index if not exists idx_brd_generations_created on public.brd_generations(created_at desc);

-- RLS: a user may read their own generation rows. Inserts happen via the
-- export-word edge function (service role, bypasses RLS). The admin report is
-- served by settings-admin (service role + admin check), so no admin SELECT
-- policy is needed here.
alter table public.brd_generations enable row level security;

create policy "brd_generations_own_read" on public.brd_generations
  for select using (user_id = auth.uid());
