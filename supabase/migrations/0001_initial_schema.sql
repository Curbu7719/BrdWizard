-- ============================================================
-- BRD Wizard — Initial Schema
-- Mirrors ARCHITECTURE.md §2.1 verbatim.
-- ============================================================

-- ============================================================
-- EXTENSIONS
-- ============================================================
create extension if not exists "uuid-ossp";

-- ============================================================
-- LOOKUP: channels (admin-editable)
-- ============================================================
create table public.channels (
  id          uuid primary key default uuid_generate_v4(),
  code        text not null unique,          -- e.g. 'SIEBEL', 'TOBI'
  label       text not null,                 -- e.g. 'Siebel', 'TOBI'
  description text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Seed data (can be changed by admin at runtime)
insert into public.channels (code, label, sort_order) values
  ('SIEBEL',      'Siebel',         1),
  ('SOT',         'SOT',            2),
  ('FAST',        'FAST',           3),
  ('C2D',         'C2D',            4),
  ('IVR',         'IVR',            5),
  ('TOBI',        'TOBI',           6),
  ('VF_YANIMDA',  'VF Yanımda',     7),
  ('WEB',         'Web',            8);

-- ============================================================
-- PROFILES (extends Supabase auth.users)
-- ============================================================
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  role          text not null default 'user',   -- 'user' | 'admin'
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Automatically create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- BRD DOCUMENTS
-- ============================================================
create type public.brd_status as enum ('draft', 'complete');
create type public.brd_visibility as enum ('public', 'private');
create type public.brd_line as enum ('CBU');           -- extend later
create type public.product_type as enum ('prepaid', 'postpaid', 'both', 'unknown');
create type public.mobility_type as enum ('mobile', 'fixed', 'both', 'unknown');
create type public.change_type as enum ('new', 'change', 'unknown');

create table public.brd_documents (
  id                uuid primary key default uuid_generate_v4(),
  owner_id          uuid not null references public.profiles(id) on delete cascade,

  -- Classification (all nullable — user can skip on first entry)
  title             text not null default 'Untitled BRD',
  business_line     brd_line not null default 'CBU',
  product_type      product_type not null default 'unknown',
  mobility_type     mobility_type not null default 'unknown',
  change_type       change_type not null default 'unknown',
  impacted_channels text[] not null default '{}',   -- array of channel codes

  -- Lifecycle
  status            brd_status not null default 'draft',
  visibility        brd_visibility not null default 'private',

  -- Context management (ADR-0001)
  active_section    text,                            -- section key currently being worked
  context_token_pct integer not null default 0,     -- 0-100, updated each turn
  handoff_package   jsonb,                           -- populated at 90% threshold

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Index for dashboard queries
create index idx_brd_documents_owner on public.brd_documents(owner_id);
create index idx_brd_documents_visibility on public.brd_documents(visibility);

-- ============================================================
-- BRD SECTIONS
-- Canonical section keys: background | objective | epics_overview
-- Extend freely — key is the source of truth
-- ============================================================
create type public.section_status as enum ('pending', 'in_progress', 'approved');

create table public.brd_sections (
  id            uuid primary key default uuid_generate_v4(),
  brd_id        uuid not null references public.brd_documents(id) on delete cascade,

  section_key   text not null,          -- 'background' | 'objective' | 'epics_overview'
  section_title text not null,          -- display label, e.g. "Background"
  sort_order    integer not null default 0,

  content_full  text,                   -- approved full text (DB source of truth)
  summary_line  text,                   -- one-line summary injected into context after approval
  status        section_status not null default 'pending',

  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (brd_id, section_key)
);

create index idx_brd_sections_brd on public.brd_sections(brd_id);

-- ============================================================
-- EPICS
-- ============================================================
create table public.epics (
  id           uuid primary key default uuid_generate_v4(),
  brd_id       uuid not null references public.brd_documents(id) on delete cascade,
  section_id   uuid references public.brd_sections(id),   -- points to epics_overview section

  title        text not null,
  description  text,
  sort_order   integer not null default 0,
  is_approved  boolean not null default false,
  approved_at  timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_epics_brd on public.epics(brd_id);

-- ============================================================
-- USER STORIES
-- ============================================================
create table public.user_stories (
  id           uuid primary key default uuid_generate_v4(),
  epic_id      uuid not null references public.epics(id) on delete cascade,
  brd_id       uuid not null references public.brd_documents(id) on delete cascade,

  -- "As a [persona] if I have permission I should be able to [action] on [channel]"
  persona      text,
  action       text not null,
  channel_hint text,                    -- e.g. 'SOT'
  full_text    text not null,           -- complete story text as approved

  is_approved  boolean not null default false,
  is_edited    boolean not null default false,   -- user manually edited AI draft
  approved_at  timestamptz,

  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_user_stories_epic on public.user_stories(epic_id);
create index idx_user_stories_brd on public.user_stories(brd_id);

-- ============================================================
-- CONVERSATION TURNS
-- Full text per ADR-0001: "DB writes everything full text"
-- ============================================================
create type public.turn_role as enum ('user', 'assistant', 'system');

create table public.conversation_turns (
  id           uuid primary key default uuid_generate_v4(),
  brd_id       uuid not null references public.brd_documents(id) on delete cascade,
  section_key  text,                    -- which section this turn belongs to
  turn_index   integer not null,        -- sequential within brd_id

  role         turn_role not null,
  content      text not null,           -- full message text

  -- Token accounting (from Anthropic response headers / usage field)
  input_tokens  integer,
  output_tokens integer,
  context_pct   integer,               -- estimated % of context window used

  -- Extended thinking audit trail (never shown to user)
  thinking_content text,

  created_at   timestamptz not null default now()
);

create index idx_turns_brd on public.conversation_turns(brd_id, turn_index);
create index idx_turns_section on public.conversation_turns(brd_id, section_key);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- profiles: user sees and edits only own profile
alter table public.profiles enable row level security;
create policy "profiles_own" on public.profiles
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- channels: anyone reads; only admin writes
alter table public.channels enable row level security;
create policy "channels_read_all" on public.channels for select using (true);
create policy "channels_admin_write" on public.channels for all
  using (exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  ));

-- brd_documents: owner always; public docs visible to all authenticated users
alter table public.brd_documents enable row level security;
create policy "brd_doc_owner" on public.brd_documents
  using (auth.uid() = owner_id);
create policy "brd_doc_public_read" on public.brd_documents for select
  using (visibility = 'public' and auth.uid() is not null);

-- brd_sections: accessible if user can access parent brd_document
alter table public.brd_sections enable row level security;
create policy "brd_sections_via_doc" on public.brd_sections
  using (
    exists (
      select 1 from public.brd_documents d
      where d.id = brd_id
        and (d.owner_id = auth.uid() or d.visibility = 'public')
    )
  );

-- epics: same gate as sections
alter table public.epics enable row level security;
create policy "epics_via_doc" on public.epics
  using (
    exists (
      select 1 from public.brd_documents d
      where d.id = brd_id
        and (d.owner_id = auth.uid() or d.visibility = 'public')
    )
  );

-- user_stories: same gate
alter table public.user_stories enable row level security;
create policy "stories_via_doc" on public.user_stories
  using (
    exists (
      select 1 from public.brd_documents d
      where d.id = brd_id
        and (d.owner_id = auth.uid() or d.visibility = 'public')
    )
  );

-- conversation_turns: owner only (never public — contains raw interview content)
alter table public.conversation_turns enable row level security;
create policy "turns_owner_only" on public.conversation_turns
  using (
    exists (
      select 1 from public.brd_documents d
      where d.id = brd_id and d.owner_id = auth.uid()
    )
  );
