# BRD Wizard — Architecture Document

**Version:** 1.0  
**Date:** 2026-06-14  
**Status:** Draft — MVP Skeleton Scope  
**Audience:** Frontend and backend developers building the first deliverable

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BROWSER (React SPA)                          │
│                                                                     │
│  ┌──────────────┐   ┌────────────────────┐   ┌─────────────────┐  │
│  │  Auth Pages  │   │  BRD Workspace     │   │  BRD List /     │  │
│  │  (Login)     │   │  ┌─────┐ ┌──────┐ │   │  Dashboard      │  │
│  │              │   │  │Chat │ │Right │ │   │                 │  │
│  │              │   │  │Panel│ │Panel │ │   │                 │  │
│  └──────┬───────┘   │  └─────┘ └──────┘ │   └────────┬────────┘  │
│         │           └────────┬───────────┘            │           │
└─────────┼────────────────────┼────────────────────────┼───────────┘
          │                    │ SSE stream              │
          │ supabase-js        │ + REST                  │ supabase-js
          ▼                    ▼                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           SUPABASE                                  │
│                                                                     │
│  ┌────────────┐  ┌─────────────────────────────────────────────┐  │
│  │ Supabase   │  │               Edge Functions (Deno)          │  │
│  │ Auth       │  │                                              │  │
│  │ (JWT)      │  │  /llm-stream     /conversation-save          │  │
│  └────────────┘  │  /section-checkpoint  /export-word          │  │
│                  │  /channel-admin                              │  │
│  ┌────────────┐  └───────────────────────┬──────────────────────┘  │
│  │ Postgres   │                          │                         │
│  │ + RLS      │◄─────────────────────────┘                         │
│  │            │                                                     │
│  └────────────┘                                                     │
└─────────────────────────────────────────────────────────────────────┘
          │
          │ HTTPS (API key stays server-side)
          ▼
┌─────────────────────┐
│   Anthropic API     │
│   (claude-sonnet-*) │
└─────────────────────┘
```

**Data flow for a streaming chat turn:**

```
User types → React sends POST to /llm-stream Edge Function
           → Edge Function builds context package (from DB + in-memory session)
           → Edge Function calls Anthropic API with stream: true
           → Anthropic returns SSE chunks
           → Edge Function pipes chunks straight to browser response (SSE)
           → React EventSource reads chunks, appends to UI
           → On stream end: Edge Function saves turn to conversation_turns table
           → If context threshold crossed: Edge Function triggers /section-checkpoint
```

**Concurrent user note:** 30 concurrent users is well within Supabase Edge Function limits (each request is a stateless Deno invocation; Anthropic API calls are per-user). No special scaling configuration required at MVP.

---

## 2. Supabase Postgres Schema

### 2.1 Full DDL

```sql
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
```

### 2.2 Table Summary

| Table | Purpose |
|---|---|
| `channels` | Admin-editable lookup for impacted-channel options |
| `profiles` | User display name and role (user/admin); auto-created on signup |
| `brd_documents` | One row per BRD; owns classification, status, visibility, context state |
| `brd_sections` | One row per BRD section; holds approved full text and one-line summary |
| `epics` | AI-generated and user-approved epics under a BRD |
| `user_stories` | User stories per epic; tracks whether user edited the AI draft |
| `conversation_turns` | Every chat turn, full text, with token counts; private to owner |

---

## 3. Edge Functions

All functions live in `supabase/functions/`. Each is a Deno HTTP handler exported as `serve()`. All require a valid Supabase JWT (`Authorization: Bearer <token>`) except where noted.

### 3.1 Function Catalogue

#### `POST /llm-stream`

**Responsibility:** The only path through which the browser touches the Anthropic API. Keeps the API key server-side. Builds the context package, calls Anthropic with streaming enabled, pipes SSE chunks back to the client, then saves the completed turn to DB.

**Request body:**
```json
{
  "brd_id": "uuid",
  "user_message": "string",
  "section_key": "string"    // current active section
}
```

**Response:** `Content-Type: text/event-stream`  
SSE events:
```
data: {"type":"delta","text":"partial response text"}
data: {"type":"usage","input_tokens":1240,"output_tokens":87,"context_pct":42}
data: {"type":"stop","stop_reason":"end_turn"}
data: [DONE]
```

**Internal flow:**
```
1. Verify JWT → extract user_id
2. Load brd_document + approved sections (for summary lines)
3. Load active section's conversation_turns (full history)
4. Build context package:
     system_prompt = platform_layer + agent_layer + session_inject(handoff_package)
     messages = [summary lines as system notes] + [active section turns] + [new user message]
5. Call LLMProvider.streamChat(messages, system_prompt)
6. For each chunk: write SSE delta to response
7. On stream complete:
     a. INSERT conversation_turns (user message + assistant response)
     b. UPDATE brd_documents.context_token_pct
     c. If context_pct >= 85: call section-checkpoint inline
     d. If context_pct >= 90: generate handoff_package, UPDATE brd_documents
```

**stop_reason handling:** If `stop_reason === "max_tokens"`, include `{"type":"truncated"}` event so the client can show "Response was cut off — continue?" UI.

---

#### `POST /conversation-save`

**Responsibility:** Explicitly save a single turn (used when client needs to save without triggering a new LLM call — e.g., saving a user edit to a story).

**Request body:**
```json
{
  "brd_id": "uuid",
  "role": "user" | "assistant",
  "content": "string",
  "section_key": "string"
}
```

**Response:** `{ "turn_id": "uuid" }`

---

#### `POST /section-checkpoint`

**Responsibility:** Mark a section as approved, write its full text to `brd_sections.content_full`, generate the one-line summary, and update `brd_documents.active_section`. Called either explicitly (user clicks "Approve Section") or automatically by `/llm-stream` at 85% threshold.

**Request body:**
```json
{
  "brd_id": "uuid",
  "section_key": "string",
  "approved_content": "string",     // full text to persist
  "trigger": "user_approval" | "auto_threshold"
}
```

**Internal flow:**
```
1. UPDATE brd_sections SET content_full = approved_content, status = 'approved', approved_at = now()
2. Call LLMProvider.complete() (non-streaming) with a short summarization prompt
   → produces one-line summary, e.g. "Section 1: Background — APPROVED ✓"
3. UPDATE brd_sections SET summary_line = <result>
4. UPDATE brd_documents SET active_section = <next section>
5. (conversation_turns for this section stay in DB but are no longer loaded into context)
```

**Response:** `{ "summary_line": "string", "next_section": "string" }`

---

#### `POST /export-word`

**Responsibility:** Assemble the complete BRD from DB and return a `.docx` binary. See section 8 for the client-side vs. server-side decision.

**Request body:**
```json
{ "brd_id": "uuid" }
```

**Internal flow:**
```
1. Load brd_document + all brd_sections (full content) + all epics + all user_stories
2. Build document tree
3. Render to .docx using a Deno-compatible OOXML library (e.g., docx npm package via esm.sh)
4. Return binary with Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
```

**Response:** Binary `.docx` stream with `Content-Disposition: attachment; filename="BRD-<title>.docx"`

---

#### `GET /channel-admin` / `POST /channel-admin` / `PATCH /channel-admin/:id`

**Responsibility:** CRUD for the `channels` lookup table. Only accessible to users with `role = 'admin'` (enforced both by RLS and by an explicit role check in the function before any write).

**GET response:** `{ "channels": [ { "id", "code", "label", "description", "sort_order", "is_active" } ] }`

**POST body:** `{ "code": "string", "label": "string", "sort_order": integer }`

---

### 3.2 Streaming Flow Diagram

```
React (EventSource)          Edge Function /llm-stream          Anthropic API
      │                              │                                │
      │── POST /llm-stream ─────────►│                                │
      │                              │── POST /messages (stream:true)►│
      │                              │                                │
      │◄── SSE: {"type":"delta"} ────│◄── chunk ──────────────────────│
      │◄── SSE: {"type":"delta"} ────│◄── chunk ──────────────────────│
      │◄── SSE: {"type":"delta"} ────│◄── chunk ──────────────────────│
      │◄── SSE: {"type":"usage"} ────│◄── message_delta (usage)───────│
      │◄── SSE: {"type":"stop"} ─────│◄── message_stop ────────────────│
      │◄── data: [DONE] ─────────────│                                │
      │                              │── INSERT conversation_turns ──►DB
      │                              │── UPDATE brd_documents ────────►DB
```

The Edge Function **never buffers the full response** — it pipes Anthropic chunks directly into the SSE response, keeping time-to-first-byte low.

---

## 4. LLMProvider Abstraction

### 4.1 Interface (TypeScript)

```typescript
// src/lib/llm/types.ts

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamEvent {
  type: 'delta' | 'usage' | 'stop' | 'error';
  text?: string;                    // present when type === 'delta'
  inputTokens?: number;             // present when type === 'usage'
  outputTokens?: number;
  contextPct?: number;
  stopReason?: 'end_turn' | 'max_tokens' | 'stop_sequence';
  error?: string;
}

export interface CompletionOptions {
  maxTokens?: number;
  stream: boolean;
  temperature?: number;
  extendedThinking?: {
    enabled: boolean;
    budgetTokens: number;
  };
  systemPrompt?: string;
}

export interface LLMProvider {
  /**
   * Streaming chat — yields StreamEvents as an async iterable.
   * The Edge Function iterates this and writes SSE chunks.
   */
  streamChat(
    messages: ChatMessage[],
    options: CompletionOptions
  ): AsyncIterable<StreamEvent>;

  /**
   * Non-streaming completion — returns full text.
   * Used for: handoff package generation, one-line summaries.
   */
  complete(
    messages: ChatMessage[],
    options: Omit<CompletionOptions, 'stream'>
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }>;

  /**
   * Returns an estimate of how many tokens the given messages would consume.
   * Used before sending to decide whether to checkpoint first.
   */
  estimateTokens(messages: ChatMessage[]): number;

  /**
   * The model identifier string (e.g. 'claude-sonnet-4-5').
   * Used for logging and debug display.
   */
  readonly modelId: string;
}
```

### 4.2 AnthropicProvider Implementation Sketch

```typescript
// supabase/functions/_shared/llm/anthropic-provider.ts
import Anthropic from 'npm:@anthropic-ai/sdk';
import type { LLMProvider, ChatMessage, CompletionOptions, StreamEvent } from './types.ts';

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  readonly modelId: string;

  constructor(apiKey: string, modelId = 'claude-sonnet-4-5') {
    this.client = new Anthropic({ apiKey });
    this.modelId = modelId;
  }

  async *streamChat(
    messages: ChatMessage[],
    options: CompletionOptions
  ): AsyncIterable<StreamEvent> {
    const stream = this.client.messages.stream({
      model: this.modelId,
      max_tokens: options.maxTokens ?? 4096,
      system: options.systemPrompt,
      messages,
      ...(options.extendedThinking?.enabled
        ? { thinking: { type: 'enabled', budget_tokens: options.extendedThinking.budgetTokens } }
        : {}),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'delta', text: event.delta.text };
      }
      if (event.type === 'message_delta' && event.usage) {
        yield {
          type: 'usage',
          outputTokens: event.usage.output_tokens,
        };
      }
      if (event.type === 'message_stop') {
        const msg = await stream.finalMessage();
        yield {
          type: 'stop',
          stopReason: msg.stop_reason as StreamEvent['stopReason'],
          inputTokens: msg.usage.input_tokens,
          outputTokens: msg.usage.output_tokens,
        };
      }
    }
  }

  async complete(
    messages: ChatMessage[],
    options: Omit<CompletionOptions, 'stream'>
  ) {
    const response = await this.client.messages.create({
      model: this.modelId,
      max_tokens: options.maxTokens ?? 1024,
      system: options.systemPrompt,
      messages,
    });
    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('');
    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  estimateTokens(messages: ChatMessage[]): number {
    // Rough estimate: 1 token ≈ 4 chars. Replace with tiktoken if precision needed.
    const chars = messages.reduce((acc, m) => acc + m.content.length, 0);
    return Math.ceil(chars / 4);
  }
}
```

### 4.3 Future CopilotProvider Slot-In

```typescript
// supabase/functions/_shared/llm/copilot-provider.ts
import type { LLMProvider, ChatMessage, CompletionOptions, StreamEvent } from './types.ts';

export class CopilotProvider implements LLMProvider {
  readonly modelId = 'gpt-4o'; // or whatever Copilot exposes

  // SDK import TBD — depends on what Microsoft publishes for Deno/Node edge
  // import { ... } from 'npm:@github-copilot/sdk'; // hypothetical

  async *streamChat(
    messages: ChatMessage[],
    options: CompletionOptions
  ): AsyncIterable<StreamEvent> {
    // TODO: verify Copilot SDK exposes streaming at all (see ADR-0001 note)
    // Map ChatMessage[] → Copilot message format
    // Map Copilot stream events → our StreamEvent interface
    // NOTE: extendedThinking is not supported — throw if options.extendedThinking?.enabled
    // NOTE: model routing (Haiku/Sonnet/Opus) is not supported — ignore modelId param
    throw new Error('CopilotProvider: not yet implemented');
  }

  async complete(messages: ChatMessage[], options: Omit<CompletionOptions, 'stream'>) {
    // Non-streaming is more likely available — implement first
    throw new Error('CopilotProvider: not yet implemented');
  }

  estimateTokens(messages: ChatMessage[]): number {
    const chars = messages.reduce((acc, m) => acc + m.content.length, 0);
    return Math.ceil(chars / 4);
  }
}
```

**Provider factory (used by all Edge Functions):**

```typescript
// supabase/functions/_shared/llm/index.ts
import { AnthropicProvider } from './anthropic-provider.ts';
import type { LLMProvider } from './types.ts';

export function createLLMProvider(): LLMProvider {
  const provider = Deno.env.get('LLM_PROVIDER') ?? 'anthropic';
  if (provider === 'anthropic') {
    return new AnthropicProvider(Deno.env.get('ANTHROPIC_API_KEY')!);
  }
  // When Copilot is ready:
  // if (provider === 'copilot') return new CopilotProvider(...);
  throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
}
```

**Known Copilot limitations to verify before switching (from ADR-0001):**
- Streaming: likely available but format differs — map carefully
- Extended thinking: not supported — guard with a capability check
- Batch API: not supported — deferred features will need Anthropic direct anyway
- Prompt caching: not supported — remove cache_control headers in CopilotProvider
- Model routing (Haiku/Sonnet/Opus): constrained — `modelId` param may be ignored
- Token usage detail: may arrive in a different schema — normalize in provider

---

## 5. Context Checkpoint Mechanism (ADR-0001)

### 5.1 Section State Machine

```
pending ──► in_progress ──► approved
                │
                └──► (user requests revision) ──► in_progress
```

### 5.2 Context Package Built on Each Turn

Every call to `/llm-stream` assembles the context package fresh from DB:

```typescript
interface ContextPackage {
  systemPrompt: string;       // 3-layer assembled prompt (see section 7)
  messages: ChatMessage[];    // what goes into the API call
}

function buildContextPackage(brd: BrdDocument, sections: BrdSection[], activeTurns: Turn[]): ContextPackage {
  // 1. Approved sections → one summary line each (tiny token cost)
  const summaryLines = sections
    .filter(s => s.status === 'approved')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(s => s.summary_line)
    .join('\n');

  // 2. Active section → full conversation history
  const historyMessages: ChatMessage[] = activeTurns.map(t => ({
    role: t.role as 'user' | 'assistant',
    content: t.content,
  }));

  // 3. Inject handoff package if resuming
  const sessionInject = brd.handoff_package
    ? `\n<session_resume>\n${JSON.stringify(brd.handoff_package, null, 2)}\n</session_resume>`
    : '';

  const systemPrompt = PLATFORM_LAYER + '\n\n' + AGENT_LAYER + '\n\n' + summaryLines + sessionInject;

  return { systemPrompt, messages: historyMessages };
}
```

### 5.3 Threshold Handling

```typescript
const CONTEXT_WINDOW = 200_000; // tokens

async function handleContextThresholds(brdId: string, tokenUsage: { inputTokens: number }) {
  const pct = Math.round((tokenUsage.inputTokens / CONTEXT_WINDOW) * 100);

  await supabase
    .from('brd_documents')
    .update({ context_token_pct: pct })
    .eq('id', brdId);

  if (pct >= 90) {
    // Generate handoff package — non-streaming call
    const pkg = await generateHandoffPackage(brdId);
    await supabase
      .from('brd_documents')
      .update({ handoff_package: pkg })
      .eq('id', brdId);
    // Return a special SSE event so client can show "Session handoff prepared" toast
    return { action: 'handoff', pkg };
  }

  if (pct >= 85) {
    // Auto-checkpoint the active section
    await autoCheckpointActiveSection(brdId);
    return { action: 'checkpoint' };
  }

  if (pct >= 70) {
    // Signal client to show warning toast; no automatic action
    return { action: 'warn' };
  }
}
```

### 5.4 Handoff Package Structure

```typescript
interface HandoffPackage {
  completedSections: {
    key: string;
    title: string;
    summaryLine: string;
  }[];
  activeSection: string;
  partialWork: string;          // last approved content in active section
  nextStep: string;             // e.g. "Continue with epic 3 user stories"
  openQuestions: string[];
  generatedAt: string;          // ISO timestamp
}
```

This JSON is stored in `brd_documents.handoff_package` and injected into the system prompt as `<session_resume>` XML on the next session load. The client sees a "Resume from where you left off" prompt in the dashboard.

### 5.5 Partial Revision

When a user wants to revise an already-approved section:
1. Client sends `PATCH /section-checkpoint` with `{ action: "reopen", section_key: "background" }`
2. Edge Function sets `brd_sections.status = 'in_progress'`
3. Next `/llm-stream` call loads the `content_full` of that section back into the active turns (as a synthetic assistant turn) rather than loading all original interview turns
4. Context cost: only that section's text, not its full interview history

---

## 6. Authentication

### 6.1 MVP: Username/Password via Supabase Auth

```typescript
// React client — login
const { data, error } = await supabase.auth.signInWithPassword({
  email: username,   // treat username as email for now
  password,
});

// React client — logout
await supabase.auth.signOut();
```

All Edge Functions extract the user from the JWT:
```typescript
const authHeader = req.headers.get('Authorization');
const { data: { user } } = await supabase.auth.getUser(authHeader?.replace('Bearer ', ''));
if (!user) return new Response('Unauthorized', { status: 401 });
```

### 6.2 LDAP Seam (Future)

Supabase Auth supports custom SAML/OIDC providers. The LDAP migration path:

1. Configure Supabase Auth to accept an OIDC token from an Azure AD or Okta connector that is itself backed by the company LDAP
2. The `profiles` table and all RLS policies use `auth.uid()` — they do not change
3. The login page swaps `signInWithPassword()` for `signInWithOAuth()` or `signInWithSSO()`
4. No schema migration required; user IDs remain UUIDs from `auth.users`

---

## 7. System Prompt Architecture

Three layers are assembled by the Edge Function (`/llm-stream`) at runtime. Agent authors only write the middle layer.

```
┌─────────────────────────────────────────────────────────┐
│  PLATFORM LAYER (hardcoded in Edge Function)            │
│  - Output language: English for UI, Turkish for content │
│  - BRD agent scope: no code, no architecture decisions  │
│  - Max turns: 15 per section                            │
│  - Format rules: one question per turn, XML for output  │
│  - Override rules: platform layer always wins           │
│  - Guardrail declarations (Tier 2 — no Jira without     │
│    explicit user approval)                              │
└─────────────────────────────────────────────────────────┘
         +
┌─────────────────────────────────────────────────────────┐
│  AGENT LAYER (file: supabase/functions/_shared/         │
│              prompts/brd-agent-skill.md)                │
│  - Role: "You are a senior BA for Vodafone Turkey CBU"  │
│  - BRD process: section order, interview style          │
│  - Channel mapping (loaded from channel-mapping.md)     │
│  - User story format with few-shot examples             │
│  - Negative instructions: one question per turn, no     │
│    tangents, no code                                    │
│  - CoT instructions for compliance steps (deferred)     │
└─────────────────────────────────────────────────────────┘
         +
┌─────────────────────────────────────────────────────────┐
│  SESSION INJECT (built at runtime by /llm-stream)       │
│  - BRD classification: product/mobility/change type,    │
│    impacted channels                                    │
│  - Completed section summary lines                      │
│  - <session_resume> JSON if resuming a handoff          │
│  - Active section name and goal                         │
└─────────────────────────────────────────────────────────┘
```

### 7.1 Channel Mapping File

`supabase/functions/_shared/prompts/channel-mapping.md`

```markdown
## Channel-to-Domain Mapping

For all retail / branch / dealer topics → SOT channel
For app / mobile topics → VF Yanımda
For chatbot interactions → TOBI
For courier-based transactions (C2D) → C2D channel
For customer service / call center → FAST channel
For web self-service → Web channel
For IVR / voice automation → IVR channel
For CRM / back-office → Siebel channel
```

This file is read at cold start by the Edge Function and injected into the Agent Layer block. Editing the file and redeploying the function updates the agent's channel knowledge. A future admin UI can write to a DB table that is loaded instead of the file — the seam is the function that assembles the Agent Layer string.

### 7.2 Prompt Files Location

```
supabase/functions/_shared/prompts/
├── platform-layer.md        # immutable; edited only by platform team
├── brd-agent-skill.md       # agent identity + BRD process
└── channel-mapping.md       # channel domain rules; editable
```

### 7.3 Extended Thinking Per Step

The `CompletionOptions.extendedThinking` flag in the LLMProvider maps to this table (from ADR-0001):

| Step | Streaming | Extended Thinking | Budget |
|---|---|---|---|
| Interview turn | yes | off | — |
| Section approval conflict check | no | on | 3,000 tokens |
| Compliance review (deferred) | yes | on | 5,000 tokens |
| Maturity scoring (deferred) | no | off (Haiku) | — |
| Story writing | yes | off | — |
| Handoff package generation | no | off | — |

Thinking content is captured in `conversation_turns.thinking_content` for audit; never sent to the browser.

---

## 8. Word Export

**Decision: server-side Edge Function using the `docx` npm package via `esm.sh`.**

### Trade-off analysis

| Option | Pros | Cons |
|---|---|---|
| **Client-side** (`docx` in React) | No round-trip; simpler deploy | Exposes full BRD data in browser memory; large bundle (+200 KB); private-doc data already in client, but adds complexity |
| **Edge Function** (chosen) | BRD data pulled server-side from DB with RLS enforcement; bundle stays lean; consistent formatting; easy to add watermarks/headers later | One extra network call |

The clincher: the Edge Function can fetch all sections, epics, and stories in one DB query server-side. The client would have to load all that data anyway, so there is no meaningful extra round-trip cost, and the document never has to be assembled in the browser.

**Deno + docx:**
```typescript
import { Document, Paragraph, HeadingLevel, Packer } from 'npm:docx@8';
// Build document tree from DB rows
const doc = new Document({ sections: [{ children: [...paragraphs] }] });
const buffer = await Packer.toBuffer(doc);
```

**Document structure:**
```
Title page: BRD title, date, owner, classification
1. Background
2. Objective
3. Epics Overview
   3.1 Epic: <title>
       User Stories:
       - As a [persona] ...
       (repeat per epic)
```

---

## 9. Folder / Repo Structure

```
brdwizard/
├── docs/
│   ├── ARCHITECTURE.md          ← this document
│   └── ADR-0001-brd-agent-context-management.md
│
├── src/                         ← React SPA (Vite + TypeScript)
│   ├── main.tsx
│   ├── App.tsx
│   ├── lib/
│   │   ├── supabase.ts          ← supabase-js client singleton
│   │   └── sse.ts               ← EventSource wrapper for /llm-stream
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useBrd.ts            ← CRUD for brd_documents
│   │   ├── useChat.ts           ← manages SSE stream + local message state
│   │   └── useSection.ts        ← section approval, revision
│   ├── components/
│   │   ├── auth/
│   │   │   └── LoginForm.tsx
│   │   ├── dashboard/
│   │   │   ├── BrdList.tsx      ← lists user's BRDs + public BRDs
│   │   │   └── BrdCard.tsx
│   │   ├── wizard/
│   │   │   ├── ClassifyForm.tsx ← prepaid/postpaid, mobile/fixed, etc.
│   │   │   ├── ChannelPicker.tsx
│   │   │   ├── ChatPanel.tsx    ← left panel: messages + input
│   │   │   ├── ApprovedPanel.tsx ← right panel: approved sections + epics
│   │   │   ├── MessageBubble.tsx
│   │   │   └── SectionBlock.tsx
│   │   └── shared/
│   │       ├── Button.tsx
│   │       └── Spinner.tsx
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── DashboardPage.tsx
│   │   └── BrdWorkspacePage.tsx
│   └── types/
│       └── brd.ts               ← TypeScript types mirroring DB schema
│
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   └── 0001_initial_schema.sql    ← all DDL from section 2
│   └── functions/
│       ├── _shared/
│       │   ├── llm/
│       │   │   ├── types.ts
│       │   │   ├── index.ts           ← createLLMProvider() factory
│       │   │   ├── anthropic-provider.ts
│       │   │   └── copilot-provider.ts  ← stub
│       │   ├── prompts/
│       │   │   ├── platform-layer.md
│       │   │   ├── brd-agent-skill.md
│       │   │   └── channel-mapping.md
│       │   ├── context-builder.ts     ← buildContextPackage()
│       │   ├── checkpoint.ts          ← threshold logic + handoff package
│       │   └── supabase-client.ts     ← service-role client for DB writes
│       ├── llm-stream/
│       │   └── index.ts
│       ├── conversation-save/
│       │   └── index.ts
│       ├── section-checkpoint/
│       │   └── index.ts
│       ├── export-word/
│       │   └── index.ts
│       └── channel-admin/
│           └── index.ts
│
├── Req.txt
├── .env.local                   ← SUPABASE_URL, SUPABASE_ANON_KEY (never commit)
└── package.json                 ← Vite + React + supabase-js + docx (client-side fallback)
```

---

## 10. Open Questions & Risks

### Critical for MVP

| # | Question / Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **Supabase Edge Function cold start latency** — Deno cold starts can add 500ms-1s to the first SSE byte. Acceptable for a 30-user internal tool, but notable. | UX | Add a "thinking..." spinner immediately on send; log cold-start times in first week. |
| 2 | **context_token_pct accuracy** — The estimate is based on a rough char/4 heuristic until Anthropic usage events arrive. The actual % is only known after the turn completes. | Context overflow | Use the `usage` field in the `message_delta` event to update the DB post-turn. Never pre-emptively refuse input. |
| 3 | **Section approval UX flow** — Does the user explicitly click "Approve Section" or does the AI propose and wait? The ADR says user approval; the UI must make this obvious. | Usability | Right panel shows a green "Approve & continue" button when the AI signals section completion; auto-checkpoint at 85% always shows a confirmation toast. |
| 4 | **Word export library in Deno** — `docx` npm package works in Deno via `esm.sh` but needs smoke-testing with `Packer.toBuffer()`. | Export feature | Test in local Supabase dev environment before committing to this approach; fallback is client-side docx. |
| 5 | **30 concurrent users + Anthropic rate limits** — Anthropic tier rate limits (tokens/min) may bite under simultaneous heavy BRD sessions. | Reliability | Monitor Anthropic dashboard in first week; add retry-with-backoff in AnthropicProvider for 529/overloaded errors. |

### Deferred — Seams to Note

| Feature | Where the seam is |
|---|---|
| KVKK compliance review | `CompletionOptions.extendedThinking` is already in the interface; add a new Edge Function `/compliance-review` that calls `LLMProvider.complete()` with thinking on. |
| Maturity scoring | Add a `/maturity-score` Edge Function; swap to Haiku model via `createLLMProvider('haiku')`. |
| Jira integration | Add a `tools` parameter to `LLMProvider.streamChat()`; implement guardrail in `/llm-stream` that intercepts `tool_use` blocks requiring approval. |
| Confluence / RAG | Add a `ragContext` field to the session inject layer; use Supabase `pgvector` extension for embeddings. |
| Batch API | Add `LLMProvider.batchComplete()` to the interface; implement in `AnthropicProvider` only (not Copilot). |
| LDAP auth | Swap `signInWithPassword()` for `signInWithSSO()`; no schema change needed. |
| GitHub Copilot SDK | Implement `CopilotProvider`; set `LLM_PROVIDER=copilot` env var; verify streaming and model routing. |

---

*End of ARCHITECTURE.md*
