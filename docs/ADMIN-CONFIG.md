# BRD Wizard — Admin Parametrization / Configuration System

**Version:** 1.0  
**Date:** 2026-06-14  
**Status:** Design — Ready for Implementation  
**Author:** Design Architect

---

## Summary

This document designs a runtime configuration system that allows an admin to modify AI model settings, context thresholds, turn limits, classification options, file policy, and prompts without redeploying the application. Two new tables (`app_settings` and `prompt_versions`) store all parameters. Edge functions load settings once per isolate invocation via a `_shared/settings.ts` loader, falling back safely to today's hardcoded defaults if a row is missing. A new Admin Settings UI section follows the established pattern from `AdminChannelsPage` / `ChannelTable`.

---

## 1. Data Model

### 1.1 Tables

#### `app_settings` — flat key → typed JSONB store

One row per named setting. The `value` column is JSONB so each setting can store a scalar, array, or structured object while remaining queryable.

```sql
-- ============================================================
-- APP_SETTINGS  (migration: 0002_admin_config.sql)
-- ============================================================
create table public.app_settings (
  key          text primary key,           -- e.g. 'ai.model_id'
  value        jsonb not null,             -- typed per key (see catalog §2)
  description  text,                       -- admin-facing description
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id) on delete set null
);

-- Seed from current hardcoded defaults (see §8.1)
-- (Seed values listed per parameter in §2)

-- RLS
alter table public.app_settings enable row level security;

-- Any authenticated user can read (edge functions use service-role; React UI reads
-- non-sensitive keys for client-side feedback like file size limit)
create policy "app_settings_read_authenticated" on public.app_settings
  for select using (auth.uid() is not null);

-- Only admin can write
create policy "app_settings_admin_write" on public.app_settings
  for all
  using (exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  ));
```

#### `prompt_versions` — versioned prompt store with restore-default support

```sql
-- ============================================================
-- PROMPT_VERSIONS  (migration: 0002_admin_config.sql)
-- ============================================================
create table public.prompt_versions (
  id           uuid primary key default uuid_generate_v4(),
  prompt_key   text not null,              -- 'platform_layer' | 'agent_skill' | 'channel_mapping'
  version      integer not null,           -- auto-incremented per key
  content      text not null,              -- full prompt text (markdown)
  is_active    boolean not null default false,  -- exactly one row per key has is_active=true
  is_default   boolean not null default false,  -- the original seed; never mutated
  label        text,                       -- admin-supplied version label, e.g. "Q3 rewrite"
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id) on delete set null,

  unique (prompt_key, version)
);

create index idx_prompt_versions_key_active on public.prompt_versions(prompt_key, is_active);

-- RLS: edge functions use service-role (bypasses RLS).
-- React admin UI uses authenticated user role.
alter table public.prompt_versions enable row level security;

create policy "prompt_versions_read_authenticated" on public.prompt_versions
  for select using (auth.uid() is not null);

create policy "prompt_versions_admin_write" on public.prompt_versions
  for all
  using (exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  ));
```

**Invariant enforced by the settings loader and the admin edge function:**
At most one row per `prompt_key` has `is_active = true`. When the admin activates a version, a DB transaction sets all other rows for that key to `is_active = false`, then sets the target row to `true`.

#### No new table needed for classification options

Classification radio values (`product_type`, `mobility_type`, `change_type`) are stored in `app_settings` as JSON arrays. The underlying DB enum columns remain as-is; see §8.3 for the migration strategy.

---

## 2. Full Parameter Catalog

### Group 1 — AI Settings (4 parameters)

| Setting Key | Type | Default | Allowed Range / Validation | Replaces |
|---|---|---|---|---|
| `ai.model_id` | `string` | `"claude-sonnet-4-6"` | Allowlist: `["claude-sonnet-4-6", "claude-opus-4-5", "claude-haiku-4-5"]` | `_shared/llm/index.ts:28` and `anthropic-provider.ts:76` constructor default |
| `ai.stream_max_tokens` | `integer` | `4096` | 256–8192 (must be integer; must be < model max) | `llm-stream/index.ts:206` (`maxTokens: 4096`) |
| `ai.complete_max_tokens` | `integer` | `1024` | 64–4096 | `anthropic-provider.ts:167` (`max_tokens: options.maxTokens ?? 1024`) |
| `ai.temperature` | `number` | `null` (API default) | `0.0–1.0` or `null` to omit from request | `anthropic-provider.ts:88,97` (temperature is already passed through as-is; currently no default — make it explicit) |

Seed SQL:
```sql
insert into public.app_settings (key, value, description) values
  ('ai.model_id',           '"claude-sonnet-4-6"', 'Anthropic model identifier for all LLM calls'),
  ('ai.stream_max_tokens',  '4096',                'max_tokens for streaming chat turns'),
  ('ai.complete_max_tokens','1024',                'max_tokens for non-streaming completions (summaries, handoff)'),
  ('ai.temperature',        'null',                'temperature for all LLM calls; null = API default (1.0)');
```

---

### Group 2 — Context & Turn Limits (5 parameters)

| Setting Key | Type | Default | Allowed Range / Validation | Replaces |
|---|---|---|---|---|
| `context.window_tokens` | `integer` | `200000` | 50000–200000 (must be ≤ actual model context window) | `_shared/checkpoint.ts:20` constant `CONTEXT_WINDOW` |
| `context.threshold_warn_pct` | `integer` | `70` | 50–89; must be < `threshold_checkpoint_pct` | `_shared/checkpoint.ts:231` (`pct >= 70`) |
| `context.threshold_checkpoint_pct` | `integer` | `85` | 51–94; must be > `threshold_warn_pct` and < `threshold_handoff_pct` | `_shared/checkpoint.ts:226` (`pct >= 85`) |
| `context.threshold_handoff_pct` | `integer` | `90` | 55–99; must be > `threshold_checkpoint_pct` | `_shared/checkpoint.ts:221` (`pct >= 90`) |
| `context.max_turns_per_section` | `integer` | `15` | 5–50 | Declared in `platform-layer.md` prompt text and in `ADR-0001`; currently NOT enforced in code — see §5 |

Seed SQL:
```sql
insert into public.app_settings (key, value, description) values
  ('context.window_tokens',              '200000', 'Model context window size in tokens'),
  ('context.threshold_warn_pct',         '70',     'Context % at which to warn the user'),
  ('context.threshold_checkpoint_pct',   '85',     'Context % at which to auto-checkpoint the active section'),
  ('context.threshold_handoff_pct',      '90',     'Context % at which to generate a session handoff package'),
  ('context.max_turns_per_section',      '15',     'Maximum conversation turns allowed per section before forced draft');
```

---

### Group 3 — Classification Options & File Limits (5 parameters)

| Setting Key | Type | Default | Allowed Range / Validation | Replaces |
|---|---|---|---|---|
| `classification.product_types` | `string[]` JSON array | `["prepaid","postpaid","both"]` | Non-empty array; each entry ≤ 40 chars; must include at least 1 item; `"unknown"` is always available as the DB default and must NOT be listed here | `ClassificationForm.tsx` options array (lines 111–115) |
| `classification.mobility_types` | `string[]` JSON array | `["mobile","fixed","both"]` | Same rules as above | `ClassificationForm.tsx` options array (lines 124–128) |
| `classification.change_types` | `string[]` JSON array | `["new","change"]` | Same rules | `ClassificationForm.tsx` options array (lines 137–141) |
| `files.max_size_mb` | `integer` | `10` | 1–50 | `ChatInput.tsx:6` `MAX_FILE_SIZE_MB = 10` |
| `files.accepted_types` | `string[]` JSON array | `[".docx"]` | Each entry must start with `.`; allowlist currently only `.docx` — extend with `.pdf`, `.txt` when backend extraction supports them | `ChatInput.tsx:7` `ACCEPTED_TYPE` constant and `accept` attribute |

Seed SQL:
```sql
insert into public.app_settings (key, value, description) values
  ('classification.product_types',  '["prepaid","postpaid","both"]', 'Radio options for Product Type in ClassificationForm'),
  ('classification.mobility_types', '["mobile","fixed","both"]',     'Radio options for Mobility Type'),
  ('classification.change_types',   '["new","change"]',              'Radio options for Change Type'),
  ('files.max_size_mb',             '10',                            'Maximum allowed attachment file size in megabytes'),
  ('files.accepted_types',          '[".docx"]',                     'Allowed attachment file extensions');
```

---

### Group 4 — Prompts (3 parameters — stored in `prompt_versions`)

| Prompt Key | Description | Current Source | Editable At Runtime |
|---|---|---|---|
| `platform_layer` | Platform rules, output format, guardrails, stop conditions, structured-output XML contract | `_shared/prompts/platform-layer.md` → embedded in `_shared/prompts/index.ts` | Yes — but changes must be intentional; it is the "immutable" layer only in the deployment sense |
| `agent_skill` | BA role, BRD process, interview style, user story format, examples | `_shared/prompts/brd-agent-skill.md` → embedded in `_shared/prompts/index.ts` | Yes |
| `channel_mapping` | Channel-to-domain mapping rules (the part Req.txt says must be editable) | `_shared/prompts/channel-mapping.md` → embedded in `_shared/prompts/index.ts` | Yes — this is the primary use case from Req.txt |

Section metadata (`SECTION_DIRECTIVE_MAP` in `context-builder.ts` and `SECTION_TITLES` / `SECTION_ORDER_MAP` in `llm-stream/index.ts`) is intentionally **not** exposed through admin config. These constants are structural code, not content — changing them requires schema thinking (new section keys, ordering logic). They are left as code constants.

Seed SQL (abbreviated — use the full text from the embedded strings in `_shared/prompts/index.ts`):
```sql
-- One insert per prompt key; is_default=true, is_active=true, version=1
insert into public.prompt_versions
  (prompt_key, version, content, is_active, is_default, label, created_by)
values
  ('platform_layer',  1, '<full text from platformLayerText>',  true, true, 'Initial seed', null),
  ('agent_skill',     1, '<full text from agentSkillText>',     true, true, 'Initial seed', null),
  ('channel_mapping', 1, '<full text from channelMappingText>', true, true, 'Initial seed', null);
```

The migration script (see §8.1) reads the embedded strings from `_shared/prompts/index.ts` at migration time to populate these rows.

---

## 3. Runtime Read Mechanism

### 3.1 `_shared/settings.ts` — the loader module

Every edge function imports this module. It fetches `app_settings` and the active `prompt_versions` rows once per Deno isolate lifetime (i.e., once per cold start, then cached in module-level variables for subsequent requests within the same isolate). A short TTL forces a reload if the isolate stays warm across a config change.

```typescript
// supabase/functions/_shared/settings.ts
//
// Loads all runtime configuration from DB.
// - Fetches app_settings (key→value) and active prompt_versions.
// - Caches in isolate-scope variables with a 60-second TTL.
// - Falls back to hardcoded defaults if any key is missing or if DB is
//   unreachable (so nothing breaks during a DB hiccup).
//
// USAGE in edge functions:
//   import { getSettings, getPrompts } from '../_shared/settings.ts';
//   const s = await getSettings(db);
//   const p = await getPrompts(db);

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// --- Hardcoded fallback defaults (mirrors current codebase) ---

export interface AppSettings {
  // Group 1: AI
  ai_model_id: string;
  ai_stream_max_tokens: number;
  ai_complete_max_tokens: number;
  ai_temperature: number | null;
  // Group 2: Context & Turns
  context_window_tokens: number;
  context_threshold_warn_pct: number;
  context_threshold_checkpoint_pct: number;
  context_threshold_handoff_pct: number;
  context_max_turns_per_section: number;
  // Group 3: Classification & Files
  classification_product_types: string[];
  classification_mobility_types: string[];
  classification_change_types: string[];
  files_max_size_mb: number;
  files_accepted_types: string[];
}

export interface ActivePrompts {
  platform_layer: string;
  agent_skill: string;
  channel_mapping: string;
}

const DEFAULTS: AppSettings = {
  ai_model_id: 'claude-sonnet-4-6',
  ai_stream_max_tokens: 4096,
  ai_complete_max_tokens: 1024,
  ai_temperature: null,
  context_window_tokens: 200_000,
  context_threshold_warn_pct: 70,
  context_threshold_checkpoint_pct: 85,
  context_threshold_handoff_pct: 90,
  context_max_turns_per_section: 15,
  classification_product_types: ['prepaid', 'postpaid', 'both'],
  classification_mobility_types: ['mobile', 'fixed', 'both'],
  classification_change_types: ['new', 'change'],
  files_max_size_mb: 10,
  files_accepted_types: ['.docx'],
};

// Import embedded prompts as the fallback (generated by gen-prompts.mjs).
import {
  platformLayerText,
  agentSkillText,
  channelMappingText,
} from './prompts/index.ts';

const PROMPT_DEFAULTS: ActivePrompts = {
  platform_layer: platformLayerText,
  agent_skill: agentSkillText,
  channel_mapping: channelMappingText,
};

// --- Isolate-scope cache ---

let cachedSettings: AppSettings | null = null;
let cachedPrompts: ActivePrompts | null = null;
let cacheExpiresAt = 0;         // Unix ms
const CACHE_TTL_MS = 60_000;   // 60 seconds

function isCacheValid(): boolean {
  return Date.now() < cacheExpiresAt && cachedSettings !== null && cachedPrompts !== null;
}

// --- Loaders ---

export async function getSettings(db: SupabaseClient): Promise<AppSettings> {
  if (isCacheValid()) return cachedSettings!;
  await refreshCache(db);
  return cachedSettings!;
}

export async function getPrompts(db: SupabaseClient): Promise<ActivePrompts> {
  if (isCacheValid()) return cachedPrompts!;
  await refreshCache(db);
  return cachedPrompts!;
}

async function refreshCache(db: SupabaseClient): Promise<void> {
  // Always reset to defaults first so partial failures don't leave stale values.
  cachedSettings = { ...DEFAULTS };
  cachedPrompts = { ...PROMPT_DEFAULTS };

  try {
    // Fetch all app_settings in a single round-trip.
    const { data: rows, error } = await db
      .from('app_settings')
      .select('key, value');

    if (!error && rows) {
      for (const row of rows) {
        applySettingRow(cachedSettings, row.key, row.value);
      }
    }

    // Fetch active prompts (one row per key where is_active=true).
    const { data: promptRows, error: promptError } = await db
      .from('prompt_versions')
      .select('prompt_key, content')
      .eq('is_active', true);

    if (!promptError && promptRows) {
      for (const row of promptRows) {
        if (row.prompt_key === 'platform_layer') cachedPrompts.platform_layer = row.content;
        if (row.prompt_key === 'agent_skill')    cachedPrompts.agent_skill    = row.content;
        if (row.prompt_key === 'channel_mapping') cachedPrompts.channel_mapping = row.content;
      }
    }

    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  } catch (err) {
    // Non-fatal: log and continue with defaults. Nothing breaks.
    console.warn('[settings] Failed to load settings from DB, using defaults:', err);
    cacheExpiresAt = Date.now() + 5_000; // retry sooner after a failure
  }
}

function applySettingRow(s: AppSettings, key: string, value: unknown): void {
  switch (key) {
    case 'ai.model_id':                          s.ai_model_id = String(value); break;
    case 'ai.stream_max_tokens':                 s.ai_stream_max_tokens = Number(value); break;
    case 'ai.complete_max_tokens':               s.ai_complete_max_tokens = Number(value); break;
    case 'ai.temperature':                       s.ai_temperature = value === null ? null : Number(value); break;
    case 'context.window_tokens':                s.context_window_tokens = Number(value); break;
    case 'context.threshold_warn_pct':           s.context_threshold_warn_pct = Number(value); break;
    case 'context.threshold_checkpoint_pct':     s.context_threshold_checkpoint_pct = Number(value); break;
    case 'context.threshold_handoff_pct':        s.context_threshold_handoff_pct = Number(value); break;
    case 'context.max_turns_per_section':        s.context_max_turns_per_section = Number(value); break;
    case 'classification.product_types':         s.classification_product_types = value as string[]; break;
    case 'classification.mobility_types':        s.classification_mobility_types = value as string[]; break;
    case 'classification.change_types':          s.classification_change_types = value as string[]; break;
    case 'files.max_size_mb':                    s.files_max_size_mb = Number(value); break;
    case 'files.accepted_types':                 s.files_accepted_types = value as string[]; break;
  }
}
```

### 3.2 Where each consumer reads each value

| Consumer | What it reads | How |
|---|---|---|
| `_shared/llm/index.ts` `createLLMProvider()` | `ai.model_id` | Accept model ID as a parameter passed in by the caller; callers (`llm-stream`, `section-checkpoint`, `checkpoint.ts`) call `getSettings(db)` first and pass `s.ai_model_id` |
| `llm-stream/index.ts` stream call | `ai.stream_max_tokens`, `ai.temperature` | `getSettings(db)` at start of handler; pass to `streamChat` options |
| `llm-stream/index.ts` `handleContextThresholds` | `context.window_tokens`, all three threshold pcts, `context.max_turns_per_section` | Pass settings object into `handleContextThresholds` (extend its signature) |
| `_shared/checkpoint.ts` | `context.window_tokens`, `context.threshold_*_pct` | Receive via parameter from caller (no direct DB call in this shared module — caller passes settings in) |
| `section-checkpoint/index.ts` LLM complete call | `ai.complete_max_tokens`, `ai.temperature` | `getSettings(db)` at start of handler |
| `_shared/context-builder.ts` `assembleAgentLayer()` | `agent_skill`, `channel_mapping` | `getPrompts(db)` — caller passes prompts object instead of using the embedded import directly |
| `_shared/context-builder.ts` `getPlatformLayer()` | `platform_layer` | Same |
| `ChatInput.tsx` `MAX_FILE_SIZE_MB`, `ACCEPTED_TYPE` | `files.max_size_mb`, `files.accepted_types` | React component fetches from a new `/api/client-config` edge function (or Supabase direct select on `app_settings`) on mount; falls back to the compile-time constant |
| `ClassificationForm.tsx` radio options | `classification.product_types`, `classification.mobility_types`, `classification.change_types` | Same client-config fetch; falls back to hardcoded arrays |

### 3.3 `createLLMProvider` signature change

```typescript
// NEW signature — callers always pass model ID from settings
export function createLLMProvider(modelId?: string): LLMProvider {
  const provider = Deno.env.get('LLM_PROVIDER') ?? 'anthropic';
  if (provider === 'anthropic') {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')!;
    return new AnthropicProvider(apiKey, modelId ?? 'claude-sonnet-4-6');
  }
  throw new Error(`Unknown LLM_PROVIDER: "${provider}"`);
}
```

Pattern in every edge function that calls LLM:
```typescript
const db = getServiceClient();
const settings = await getSettings(db);
const llm = createLLMProvider(settings.ai_model_id);
```

### 3.4 `context-builder.ts` signature change

```typescript
// context-builder.ts — add prompts parameter
export function buildContextPackage(
  brd: BrdDocument,
  sections: BrdSection[],
  activeTurns: ConversationTurn[],
  userMessage: string,
  epics: EpicRow[] = [],
  prompts?: ActivePrompts,         // NEW — falls back to embedded if not supplied
): ContextPackage {
  const platform = prompts?.platform_layer ?? platformLayerText;
  const agent    = (prompts?.agent_skill ?? agentSkillText)
                     .replace('{{CHANNEL_MAPPING}}', prompts?.channel_mapping ?? channelMappingText);
  // ...rest unchanged, use `platform` and `agent` instead of function calls
}
```

---

## 4. Prompt Editing Without Redeploy

### 4.1 Design

Prompts are stored in `prompt_versions` with versioning so the admin can:
- Draft a new version without it going live
- Activate a specific version
- Restore the original seed at any time (the `is_default = true` row is never mutated)
- Preview how a prompt will look (read-only formatted display)

The `gen-prompts.mjs` + `prompts/index.ts` pipeline remains as the seed and fallback. After seeding the DB, the runtime reads from `prompt_versions` (active row) and falls back to the embedded constants only if the DB query fails.

The `{{CHANNEL_MAPPING}}` placeholder mechanism is preserved: `channel_mapping` is still a separate prompt key. The context-builder replaces the placeholder at assembly time exactly as today. The admin edits each as an independent text block.

### 4.2 Admin prompt workflow

```
1. Admin opens "Prompts" tab in Admin Settings UI
2. Selects a prompt key (e.g., "Channel Mapping")
3. Sees current active version content in a read-only diff pane
4. Clicks "New Version" — opens a full-text editor populated with the current content
5. Makes changes, optionally enters a version label
6. Clicks "Save Draft" — inserts a new row with is_active=false
7. Clicks "Activate" (or a separate confirm step) — the edge function:
   a. Server-side validates the content (non-empty, size < 100 KB)
   b. Sets all other rows for that key to is_active=false
   c. Sets the new row to is_active=true
8. Cache TTL expires (≤ 60s) and all warm isolates pick up the new content
9. Admin can click "Restore Default" — same as activating the is_default=true row
```

### 4.3 Preview

The preview calls the same context assembly logic in the browser and shows the composed system prompt in a modal. For `channel_mapping`, the preview shows only that block. For `agent_skill`, the preview shows `agent_skill` with the active `channel_mapping` injected. No live LLM call is made for preview.

### 4.4 `admin-settings` edge function (new)

A new edge function `supabase/functions/admin-settings/index.ts` handles all admin-config reads and writes, mirroring `channel-admin`. This keeps DB mutation logic server-side, allowing server-side validation (§6) before any row is written.

Methods:
- `GET /admin-settings` — returns all `app_settings` rows + all `prompt_versions` rows grouped by key
- `PATCH /admin-settings/setting` — update one `app_settings` row; body: `{ key, value }`
- `POST /admin-settings/prompt` — create a new draft `prompt_versions` row; body: `{ prompt_key, content, label }`
- `PATCH /admin-settings/prompt/:id/activate` — activate a specific version
- `GET /admin-settings/client-config` — public (no auth) endpoint returning only the keys safe for the browser: `files.max_size_mb`, `files.accepted_types`, `classification.*` (the chat UI needs these before the user logs in to classification)

---

## 5. Max-Turns Enforcement

### 5.1 Where to enforce

The platform layer prompt already declares "Maximum 15 turns per section" but this is a soft instruction. The ADR says `max_turns` is a platform-level stop condition. Enforcement must be in `llm-stream/index.ts` before the Anthropic API call is made, so the LLM call is blocked rather than just warned about.

### 5.2 Turn counting

In `llm-stream/index.ts`, after loading `activeTurns` from DB:

```
const userTurnCount = activeTurns.filter(t => t.role === 'user').length;
const maxTurns = settings.context_max_turns_per_section; // from getSettings()
```

Count only user turns (each user message = one turn). This matches the ADR phrasing ("max: 15 tur").

### 5.3 Behavior when limit is exceeded

Two-phase approach: warn at `maxTurns - 1`, block at `maxTurns`.

```
if (userTurnCount >= maxTurns) {
  // BLOCK — do not call Anthropic
  // Instead emit a special SSE event + a synthetic assistant message
  const blockedResponse = {
    type: 'turns_exceeded',
    turn_count: userTurnCount,
    max_turns: maxTurns,
  };
  // Also send a system message visible to the user:
  // "Maximum turns for this section reached. Use 'Draft for approval' to finalize
  //  this section and move on, or request a forced draft."
  // Emit this as SSE delta + stop events so useChat renders it like a normal message.
  // Then emit [DONE].
  return;
}

if (userTurnCount === maxTurns - 1) {
  // WARN — proceed with LLM call but inject a <context_warning> into system prompt
  // to signal the agent to wrap up. The platform layer already instructs the agent
  // to propose a summary at max_turns — this makes it aware it is the last turn.
  systemPromptSuffix = '\n<context_warning>This is the final allowed turn for this section. Propose a complete section draft immediately.</context_warning>';
}
```

The `turns_exceeded` SSE event type must be added to `SseStreamEvent` in `src/types/brd.ts`.

The frontend (`BrdWorkspacePage.tsx`) handles `turns_exceeded` by:
- Rendering the system message in the chat
- Prominently showing the "Draft for approval" button (already wired via `draftButtonLabel` prop on `ChatInput`)
- Blocking further message sends until the user clicks "Draft for approval" or approves the section

The `[draft-section]` synthetic message path (already implemented in the platform layer and `ChatInput.tsx`) provides the user their way out — it forces a draft even before turns are exhausted.

---

## 6. Server-Side Validation

All writes to `app_settings` and `prompt_versions` go through the `admin-settings` edge function. The function validates before writing to DB. Client-side validation in the Admin UI is convenience only — the edge function never trusts it.

### 6.1 Validation rules

```typescript
// admin-settings validation (all errors return 400 with a descriptive message)

function validateSetting(key: string, value: unknown): string | null {
  switch (key) {
    case 'ai.model_id':
      const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-5', 'claude-haiku-4-5'];
      if (!ALLOWED_MODELS.includes(String(value)))
        return `model_id must be one of: ${ALLOWED_MODELS.join(', ')}`;
      break;

    case 'ai.stream_max_tokens':
      if (!Number.isInteger(value) || (value as number) < 256 || (value as number) > 8192)
        return 'stream_max_tokens must be an integer between 256 and 8192';
      break;

    case 'ai.complete_max_tokens':
      if (!Number.isInteger(value) || (value as number) < 64 || (value as number) > 4096)
        return 'complete_max_tokens must be an integer between 64 and 4096';
      break;

    case 'ai.temperature':
      if (value !== null && (typeof value !== 'number' || (value as number) < 0 || (value as number) > 1))
        return 'temperature must be a number between 0.0 and 1.0, or null';
      break;

    case 'context.window_tokens':
      if (!Number.isInteger(value) || (value as number) < 50_000 || (value as number) > 200_000)
        return 'window_tokens must be an integer between 50000 and 200000';
      break;

    case 'context.threshold_warn_pct':
    case 'context.threshold_checkpoint_pct':
    case 'context.threshold_handoff_pct':
      if (!Number.isInteger(value) || (value as number) < 50 || (value as number) > 99)
        return `${key} must be an integer between 50 and 99`;
      // Ordering check: requires reading the other two thresholds from DB
      // (done in a cross-key validation pass after individual checks)
      break;

    case 'context.max_turns_per_section':
      if (!Number.isInteger(value) || (value as number) < 5 || (value as number) > 50)
        return 'max_turns_per_section must be an integer between 5 and 50';
      break;

    case 'classification.product_types':
    case 'classification.mobility_types':
    case 'classification.change_types':
      if (!Array.isArray(value) || (value as unknown[]).length === 0)
        return `${key} must be a non-empty array`;
      if ((value as unknown[]).some(v => typeof v !== 'string' || (v as string).length > 40))
        return `${key}: each option must be a string ≤ 40 characters`;
      break;

    case 'files.max_size_mb':
      if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 50)
        return 'max_size_mb must be an integer between 1 and 50';
      break;

    case 'files.accepted_types':
      if (!Array.isArray(value) || (value as unknown[]).length === 0)
        return 'accepted_types must be a non-empty array';
      if ((value as unknown[]).some(v => typeof v !== 'string' || !(v as string).startsWith('.')))
        return 'each accepted type must be a string starting with "."';
      break;
  }
  return null; // valid
}

// Cross-key threshold ordering check (called after all individual checks pass):
function validateThresholdOrdering(warn: number, checkpoint: number, handoff: number): string | null {
  if (!(warn < checkpoint && checkpoint < handoff))
    return `Thresholds must be strictly ordered: warn (${warn}) < checkpoint (${checkpoint}) < handoff (${handoff})`;
  return null;
}
```

Prompt content validation:
- `content` must be a non-empty string
- `content.length` must be ≤ 100,000 characters (prevents accidental huge pastes)
- Must contain no null bytes

---

## 7. Admin Settings UI

### 7.1 Navigation and routing

Mirror the existing `AdminChannelsPage` pattern. Add a new route `/admin/settings` and a link from the admin nav (alongside the existing `/admin/channels` link).

The page uses the same role-gate pattern as channels: on mount, check `profiles.role === 'admin'`; if not, redirect to `/`.

```
/admin/channels  →  AdminChannelsPage (existing)
/admin/settings  →  AdminSettingsPage (new)
```

### 7.2 Layout — tab-based

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← Dashboard   |   Admin — Settings                                     │
├─────────────────────────────────────────────────────────────────────────┤
│  [AI Model & Limits]  [Context & Turns]  [Classification & Files]  [Prompts]  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   (tab content — see per-tab wireframes below)                          │
│                                                                         │
│   [Save Changes]                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

Each tab reads the current values from `admin-settings` GET and posts changes via `admin-settings` PATCH. Only changed fields are sent. A "Saved" toast confirms success; validation errors from the edge function appear as inline field errors.

### 7.3 Tab: AI Model & Limits

```
┌─────────────────────────────────────────────────────────────┐
│  AI Model & Limits                                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Model ID                                                    │
│  ┌──────────────────────────────────┐                        │
│  │ claude-sonnet-4-6            [v] │  (dropdown)            │
│  └──────────────────────────────────┘                        │
│  Options: claude-sonnet-4-6 / claude-opus-4-5 /             │
│           claude-haiku-4-5                                   │
│                                                              │
│  Max tokens (streaming)    Max tokens (completions)          │
│  ┌──────────┐               ┌──────────┐                     │
│  │  4096    │               │  1024    │                     │
│  └──────────┘               └──────────┘                     │
│  Range: 256–8192             Range: 64–4096                  │
│                                                              │
│  Temperature    (blank = API default)                        │
│  ┌──────────┐                                                │
│  │          │                                                │
│  └──────────┘                                                │
│  Range: 0.0–1.0 or leave empty for API default              │
│                                                              │
│  [Save AI Settings]                                          │
└─────────────────────────────────────────────────────────────┘
```

### 7.4 Tab: Context & Turns

```
┌─────────────────────────────────────────────────────────────┐
│  Context & Turns                                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Context Window (tokens)                                     │
│  ┌──────────┐                                                │
│  │  200000  │   Range: 50000–200000                         │
│  └──────────┘                                                │
│                                                              │
│  Threshold Percentages                                       │
│  (must be strictly increasing: warn < checkpoint < handoff) │
│                                                              │
│  Warn %    Checkpoint %    Handoff %                        │
│  ┌──────┐  ┌──────────┐   ┌────────┐                       │
│  │  70  │  │    85    │   │   90   │                        │
│  └──────┘  └──────────┘   └────────┘                       │
│                                                              │
│  Max turns per section                                       │
│  ┌──────┐                                                    │
│  │  15  │   Range: 5–50                                     │
│  └──────┘                                                    │
│                                                              │
│  [Save Context Settings]                                     │
└─────────────────────────────────────────────────────────────┘
```

The three threshold inputs cross-validate in real time (client-side) with a live error: "Thresholds must be in ascending order." The edge function validates again server-side.

### 7.5 Tab: Classification & Files

```
┌─────────────────────────────────────────────────────────────┐
│  Classification & Files                                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Product Types   (comma-separated)                           │
│  ┌────────────────────────────────────────┐                 │
│  │ prepaid, postpaid, both                │                 │
│  └────────────────────────────────────────┘                 │
│  (note: "unknown" is always available as a DB default       │
│   and is not listed here)                                    │
│                                                              │
│  Mobility Types                                              │
│  ┌────────────────────────────────────────┐                 │
│  │ mobile, fixed, both                    │                 │
│  └────────────────────────────────────────┘                 │
│                                                              │
│  Change Types                                                │
│  ┌────────────────────────────────────────┐                 │
│  │ new, change                            │                 │
│  └────────────────────────────────────────┘                 │
│                                                              │
│  ─── File Policy ────────────────────────────────────────── │
│                                                              │
│  Max file size (MB)   Accepted extensions                    │
│  ┌──────────┐         ┌───────────────────────────────┐    │
│  │    10    │         │ .docx                         │    │
│  └──────────┘         └───────────────────────────────┘    │
│  Range: 1–50          Comma-separated (e.g. .docx, .pdf)   │
│                                                              │
│  [Save Classification & File Settings]                       │
└─────────────────────────────────────────────────────────────┘
```

Classification type inputs use a tag-editor component (similar to a comma-input that converts to chips on blur) rather than a plain textarea, to make individual entry management clear. If such a component is not already in the UI kit, a plain `<Input>` with comma-separated values and a warning label is sufficient for MVP.

### 7.6 Tab: Prompts

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Prompts                                                                  │
├──────────────┬──────────────────────────────────────────────────────────┤
│  Platform    │                                                            │
│  Layer       │  Active Version: v1 "Initial seed"  [New Version]        │
│              │  ─────────────────────────────────────────────────────── │
│  Agent Skill │  ┌─────────────────────────────────────────────────────┐ │
│              │  │                                                       │ │
│  Channel     │  │  (read-only formatted display of active content)     │ │
│  Mapping  ← │  │                                                       │ │
│  (selected)  │  │                                                       │ │
│              │  └─────────────────────────────────────────────────────┘ │
│              │                                                            │
│              │  Version History                                           │
│              │  ┌─────────────────────────────────────────────────────┐ │
│              │  │ v2  "Q3 channel rewrite"  2026-06-14  [Activate]    │ │
│              │  │ v1  "Initial seed" (default) (active) [Preview]     │ │
│              │  └─────────────────────────────────────────────────────┘ │
│              │                                                            │
│              │  [Restore Default]                                         │
└──────────────┴──────────────────────────────────────────────────────────┘
```

When "New Version" is clicked, the display area becomes an editable textarea pre-populated with the active version content. "Save Draft" inserts without activating. "Save & Activate" saves and activates in one step (with a confirmation dialog: "This will update the active prompt immediately. All requests in the next 60 seconds may use either version.").

"Restore Default" is a special case of Activate that always targets the `is_default = true` row.

### 7.7 Components

Reuse from existing codebase:
- `Button`, `Input`, `Switch`, `Spinner` (already in `/src/components/ui/`)
- Page shell + header pattern from `AdminChannelsPage.tsx`
- Toast from `useToast` hook
- Role-guard: same pattern as channels (redirect if not admin)

New components:
- `AdminSettingsPage.tsx` — page shell with tab navigation
- `AiSettingsTab.tsx` — Group 1 fields
- `ContextSettingsTab.tsx` — Group 2 fields with cross-validation
- `ClassificationFilesTab.tsx` — Group 3 fields with tag-like input
- `PromptsTab.tsx` — sidebar key list + content pane + version history table
- `PromptEditor.tsx` — full-text textarea with save/activate/restore actions
- `PromptVersionHistory.tsx` — version list table (mirrors `ChannelTable` style)

---

## 8. Migration & Rollout Plan

### 8.1 Migration file: `0002_admin_config.sql`

Order of operations in the migration:

1. Create `app_settings` table with RLS
2. Seed all 14 `app_settings` rows with current hardcoded defaults
3. Create `prompt_versions` table with RLS
4. Seed 3 `prompt_versions` rows (`is_active = true`, `is_default = true`, `version = 1`) using the current text from `_shared/prompts/index.ts`
5. No changes to existing tables

The seeding of `prompt_versions` content must be done via a separate seed script (not raw SQL inline) because the prompt texts are long. `scripts/seed-prompts.mjs` reads `_shared/prompts/index.ts` and runs a Supabase insert using the service role key.

### 8.2 Application code changes (order matters for zero-downtime)

**Phase 1 — Add loader, keep hardcoded values as fallback (safe to deploy first):**
- Add `_shared/settings.ts` with caching and fallback
- Modify `llm-stream`, `section-checkpoint`, `checkpoint.ts` to call `getSettings()` but fall back to the current constants if the DB rows don't exist yet
- Modify `context-builder.ts` to accept optional `prompts` parameter but continue using embedded fallback
- **No behavior change yet** — DB rows don't exist, all fallbacks fire

**Phase 2 — Run migration `0002_admin_config.sql` + seed script:**
- Now DB rows exist with the same values as the current hardcoded constants
- All edge functions start reading from DB but produce identical results

**Phase 3 — Ship `admin-settings` edge function:**
- Admin can now read and write settings
- Existing functionality unchanged

**Phase 4 — Ship Admin Settings UI:**
- `AdminSettingsPage.tsx` + tabs + route `/admin/settings`

**Phase 5 — Update React client-side constants:**
- `ChatInput.tsx` and `ClassificationForm.tsx` fetch from `admin-settings/client-config` on mount
- Hardcoded constants remain as compile-time fallbacks (if the fetch fails, constants apply)

### 8.3 Classification enum strategy

**Problem:** `product_type`, `mobility_type`, `change_type` are Postgres enums. Adding new values to an enum requires `ALTER TYPE ... ADD VALUE`, which is safe in Postgres but requires a DB migration. Removing values is not possible without recreating the type and migrating data.

**Chosen approach: Keep the DB enum columns, surface as a soft list in admin UI.**

The `app_settings` rows for `classification.*` control what the **UI shows as options**. The DB enum still validates at the column level. This means:

- Admin can remove an option from the UI list (it won't appear as a radio), but existing BRD rows with that value are unaffected
- Admin can add an option to the UI list only if the value also exists in the DB enum; otherwise the BRD insert will fail
- Adding a new enum value (e.g., `'hybrid'`) still requires a DB migration (`ALTER TYPE product_type ADD VALUE 'hybrid'`), but this is a one-time DBA step — after which the admin can add the label to the UI list without a code deploy

**Short-term (MVP):** The admin settings list is a subset of the existing enum values. The admin can hide values (remove from list) but not add new enum values without a migration. Document this constraint clearly in the Admin UI tooltip.

**Long-term:** If the business frequently needs new classification values, replace the DB enum columns with `text` columns referencing a `classification_options` lookup table (like `channels`). This is a future migration path — not needed now.

**Validation rule in `admin-settings` edge function:**

```typescript
// When writing classification.product_types, verify all values exist in the enum.
// This requires a known allowlist at the code level — acceptable trade-off.
const VALID_PRODUCT_TYPES = ['prepaid', 'postpaid', 'both', 'unknown'];
for (const v of newValues) {
  if (!VALID_PRODUCT_TYPES.includes(v))
    return 400 `"${v}" is not a valid product_type enum value`;
}
```

### 8.4 Backward compatibility

- `gen-prompts.mjs` and `_shared/prompts/index.ts` remain unchanged — they are the seed source and the fallback
- The `LLM_PROVIDER` env var continues to work unchanged
- No existing DB columns change
- All SSE event types remain backward compatible (one addition: `turns_exceeded`)

---

## 9. Task Split

### 9.1 Backend tasks (Supabase Edge Functions + migration)

| Task | Files | Notes |
|---|---|---|
| B1: Write migration `0002_admin_config.sql` | `supabase/migrations/0002_admin_config.sql` | DDL for `app_settings` and `prompt_versions` with RLS |
| B2: Write seed script for prompts | `scripts/seed-prompts.mjs` (extend existing pattern) | Reads from `_shared/prompts/index.ts`, inserts into `prompt_versions` |
| B3: Write `_shared/settings.ts` | New file | Loader, cache, fallbacks |
| B4: Wire settings into `llm-stream/index.ts` | Existing file | `getSettings()` call, pass to `createLLMProvider`, `handleContextThresholds`, `buildContextPackage` |
| B5: Wire settings into `checkpoint.ts` | Existing file | Replace `CONTEXT_WINDOW` constant and threshold constants with parameters passed in from callers |
| B6: Wire settings into `section-checkpoint/index.ts` | Existing file | `getSettings()` for complete max_tokens and temperature |
| B7: Wire prompts into `context-builder.ts` | Existing file | Add optional `prompts` parameter; use `getPrompts()` result |
| B8: Add turn enforcement to `llm-stream/index.ts` | Existing file | Turn count check before Anthropic call; `turns_exceeded` SSE event |
| B9: Write `admin-settings/index.ts` edge function | New file | GET (all settings + prompts), PATCH (settings), POST (prompt draft), PATCH (activate), GET client-config |
| B10: Update `_shared/llm/index.ts` `createLLMProvider` | Existing file | Accept optional `modelId` parameter |

### 9.2 Frontend tasks (React SPA)

| Task | Files | Notes |
|---|---|---|
| F1: Add `turns_exceeded` to `src/types/brd.ts` `StreamEventType` | Existing file | Backend owns this file per FLOW-INTEGRATION.md |
| F2: Handle `turns_exceeded` in `useChat.ts` | Existing file | Render system message, expose `turnsExceeded` state |
| F3: Update `BrdWorkspacePage.tsx` for turn exhaustion UX | Existing file | Show "Draft for approval" button prominently when turns exhausted |
| F4: Update `ChatInput.tsx` to fetch file limits from `client-config` | Existing file | Replace compile-time constants with runtime fetch + fallback |
| F5: Update `ClassificationForm.tsx` to fetch classification options | Existing file | Replace hardcoded option arrays with runtime fetch + fallback |
| F6: Create `AdminSettingsPage.tsx` and register route | New file + `App.tsx` | Tab shell, role-guard, route `/admin/settings` |
| F7: Create `AiSettingsTab.tsx` | New file | Group 1 fields |
| F8: Create `ContextSettingsTab.tsx` | New file | Group 2 fields + cross-validation |
| F9: Create `ClassificationFilesTab.tsx` | New file | Group 3 fields |
| F10: Create `PromptsTab.tsx`, `PromptEditor.tsx`, `PromptVersionHistory.tsx` | New files | Prompt editing UI, version history table, activate/restore |

---

## 10. Open Questions & Risks

### Top 3 Risks

**Risk 1 — Cache staleness across warm isolates**

The 60-second TTL means a setting change takes up to 60 seconds to propagate to all running isolates. During that window, some requests will use the old value and some the new value (whichever isolate handles them).

Mitigation: Document this in the Admin UI ("Changes take effect within 60 seconds"). For prompt changes this is acceptable — no BRD will be broken by a 60-second window of mixed prompt versions. For threshold changes the window is similarly safe. If instant propagation is required in the future, add a `cache_bust_at` column to `app_settings` and compare it to the isolate's local cache timestamp on every request (one extra DB column read, low overhead).

**Risk 2 — Classification option mismatch with DB enum**

If an admin adds a classification label to the UI list but that value does not exist in the Postgres enum, BRD creation will fail at the DB insert level with a cryptic constraint error. The edge function validation catches known enum values, but a DBA adding a new enum value without also updating the validation allowlist in code creates a gap.

Mitigation: The validation allowlist in the `admin-settings` edge function is the single list of valid enum values. Whenever a DBA runs `ALTER TYPE ... ADD VALUE`, they must also update this list (one line). Document this as the procedure. In the long term, replace enums with lookup tables (see §8.3).

**Risk 3 — Prompt corruption breaking all BRD sessions**

A bad prompt edit (e.g., removing the `{{CHANNEL_MAPPING}}` placeholder from `agent_skill`) will silently break context assembly for all subsequent sessions. The 60-second cache TTL means all isolates pick up the bad content quickly.

Mitigation: The version history in `prompt_versions` makes rollback instant — one PATCH to activate the previous version. The "Restore Default" button always targets the `is_default=true` row which is never mutated. A preview step before activation allows the admin to review the assembled system prompt. Consider adding a simple structural validation in the `admin-settings` edge function for `agent_skill`: verify that `{{CHANNEL_MAPPING}}` is still present in the content before activating, returning a 400 if not.

### Open Questions

| # | Question | Impact |
|---|---|---|
| 1 | Should prompt versions be diff-viewable (current vs. new)? Requires a diff library (e.g., `diff` npm package) in the edge function or client side. | UX quality |
| 2 | Should `ai.model_id` apply only to new sessions or to all in-flight sessions immediately? Given the 60s TTL, in-flight SSE streams are unaffected (they already have the LLM instantiated). Only new calls pick up the new model. Is this the desired behavior? | Session consistency |
| 3 | Is `platform_layer` intended to be admin-editable in production, or should it require a more privileged role (e.g., `super_admin`)? The current design makes it editable by `role = 'admin'`. If it should be protected, add a `super_admin` role check for that specific prompt key. | Security / governance |
| 4 | Should classification option changes apply to existing BRD documents? (No — they only affect the options shown in `ClassificationForm` for new BRDs. Existing BRDs store the selected value in the DB and are unaffected.) Document this expectation. | Data integrity |
| 5 | Does `files.accepted_types` expansion (e.g., adding `.pdf`) require backend file extraction support? Yes — the current edge functions do nothing with the attached file beyond passing it to the LLM. Adding `.pdf` to the accepted list without extraction support means PDFs are silently ignored. Gate this behind backend extraction being ready. | Feature completeness |
