# BRD Wizard — Flow Integration Contract

**Version:** 1.0  
**Date:** 2026-06-14  
**Status:** Implementation-ready  
**Audience:** Backend dev (Supabase Edge Functions) and Frontend dev (React SPA)  
**Authority:** This document is the binding seam contract between backend and frontend. `src/types/brd.ts` is the shared type file — backend owns edits, frontend consumes.

---

## 0. Problem Statement

The streaming chat works, but three critical gaps prevent the structured BRD from being built:

1. The agent emits plain prose — no machine-parseable structured blocks. The backend cannot extract sections, epics, or stories from raw text.
2. `llm-stream` never scans the completed assistant response for structured blocks and therefore never writes to `brd_sections`, `epics`, or `user_stories`.
3. The approval UI components (`EpicProposalCard`, `StoryApprovalCard`, `ClassificationForm`) exist but are never rendered — no trigger reaches them.
4. `useChat` starts with empty messages on every mount — resuming a BRD shows nothing.

This document closes all four gaps.

---

## 1. End-to-End Flow State Machine

### 1.1 BRD Lifecycle States

The `brd_documents.status` enum has two values: `draft` and `complete`. The flow progresses through named phases tracked by `brd_documents.active_section`.

```
Phase 0: CLASSIFY
  brd_documents.active_section = null
  Action: Frontend renders ClassificationForm, user fills and submits
  Transition: supabase-js PATCH brd_documents → sets title, product_type, mobility_type,
              change_type, impacted_channels, active_section = 'background'
  Emits: no SSE; direct supabase-js write

Phase 1: BACKGROUND INTERVIEW
  active_section = 'background'
  brd_sections row: section_key='background', sort_order=0, status=pending→in_progress
  Action: Agent asks interview questions; user answers
  Completion signal: agent emits <section_draft key="background">…</section_draft>
  Transition: backend parses block → SSE 'section_ready' → frontend shows approve button
  On user approval: POST /section-checkpoint → status='approved' → active_section='objective'

Phase 2: OBJECTIVE INTERVIEW
  active_section = 'objective'
  brd_sections row: section_key='objective', sort_order=1
  Same as Background. Agent emits <section_draft key="objective">…</section_draft>
  Transition: 'section_ready' SSE → approve → active_section='epics_overview'

Phase 3: EPIC PROPOSAL
  active_section = 'epics_overview'
  brd_sections row: section_key='epics_overview', sort_order=2
  Action: Agent proposes epic list
  Completion signal: agent emits <epics>…</epics> XML block
  Transition: backend parses → inserts epics rows (is_approved=false) →
              SSE 'epics_proposed' → frontend renders EpicProposalCard
  On user approval: supabase-js UPDATE epics SET is_approved=true (all) →
              POST /section-checkpoint for 'epics_overview' →
              active_section = 'epic_1_stories'

Phase 4+: USER STORY GENERATION (one per epic, in sort_order)
  active_section = 'epic_<n>_stories'  (n = epic sort_order + 1, 1-based)
  Action: Agent generates stories for the current epic
  Completion signal: agent emits <stories epic_id="…">…</stories> block
  Transition: backend parses → inserts user_stories rows (is_approved=false) →
              SSE 'stories_ready' → frontend renders StoryApprovalCard per story
  Per-story approval: supabase-js UPDATE user_stories SET is_approved=true
  When all stories for this epic are approved:
    → active_section = 'epic_<n+1>_stories' (next epic)
    → or if last epic: brd_documents.status = 'complete', active_section = null

COMPLETE
  status = 'complete'
  All sections approved, all epics approved, all stories approved
  Export Word is unlocked without partial warning
```

### 1.2 Section Keys and Sort Orders

| section_key | section_title | sort_order |
|---|---|---|
| `background` | Background | 0 |
| `objective` | Objective | 1 |
| `epics_overview` | Epics Overview | 2 |

Epic story sections (`epic_1_stories`, `epic_2_stories`, …) are tracked via `brd_documents.active_section` only; they do NOT get their own `brd_sections` rows. Stories are associated to epics directly via the `epics` / `user_stories` tables.

### 1.3 Skippable Classification (per Req)

Classification is always shown once on first entry to the workspace when `brd_documents.product_type = 'unknown'` (the DB default). The user may click "Start BRD" without filling anything except title. The backend uses whatever is stored — `context-builder.ts`'s `classificationBlock` already handles `'unknown'` values gracefully. No special skip path needed beyond this.

---

## 2. Structured Agent Output Contract

### 2.1 Principle

The agent streams natural-language conversation throughout. When it is ready to propose or finalize structured content, it emits a machine-parseable XML block **at the very end of its response**, after the natural-language prose. The platform layer instructs the agent to do this; the backend scans the full accumulated assistant response after the stream completes.

### 2.2 Section Draft Block

Emitted when the agent has drafted a BRD section and is presenting it for approval.

```xml
<section_draft key="background">
Full section prose here. May be multiple paragraphs.
Markdown is acceptable.
</section_draft>
```

Rules:
- `key` must be `background`, `objective`, or `epics_overview`.
- The block appears once per section, at the end of the response.
- Natural-language prefix (before the tag) contains the conversational prompt, e.g. "Here is a draft of the Background section. Please review and say 'approve' to continue, or tell me what to change."
- The block is not shown to the user as raw XML — the frontend renders it as the section card.

### 2.3 Epic Proposal Block

Emitted when the agent proposes the epic list.

```xml
<epics>
  <epic title="Invoice Viewing" sort_order="0">Store employees can view subscriber invoices on the SOT channel.</epic>
  <epic title="Permission Management" sort_order="1">Role-based access control for billing data visibility.</epic>
  <epic title="Audit Trail" sort_order="2">Log all invoice access events for compliance.</epic>
</epics>
```

Rules:
- `title` is required; `sort_order` is 0-based and must be unique.
- Description text is the element body.
- Natural-language prefix contains the conversational framing, e.g. "Based on our discussion, here are the proposed epics."
- Backend inserts these as `epics` rows with `is_approved=false`.

### 2.4 User Stories Block

Emitted when the agent has generated all stories for the current epic.

```xml
<stories epic_id="{{EPIC_DB_ID}}">
  <story persona="store employee" channel="SOT" sort_order="0">As a store employee, if I have permission, I should be able to view a subscriber's outstanding invoice on the SOT channel.</story>
  <story persona="store manager" channel="SOT" sort_order="1">As a store manager, if I have permission, I should be able to export a subscriber's invoice history on the SOT channel.</story>
</stories>
```

Rules:
- `epic_id` is the UUID of the epic row — the backend must inject this into the agent's context when starting story generation (see §6.3).
- `persona` and `channel` are required; `sort_order` is 0-based within the epic.
- The `full_text` DB column is set to the element body text (the story sentence).
- `action` DB column: extract everything after "I should be able to" up to "on the". Backend does this extraction. If extraction fails, store full_text in `action` as well.
- `channel_hint` DB column: set from the `channel` attribute.
- Natural-language prefix contains the agent's framing per story or per batch.

### 2.5 Agent Signalling Language

The platform layer prompt (to be added to `platform-layer.md`) instructs:

```
When you have completed a full section draft, always append a <section_draft> XML block
at the end of your response. Do not emit this block mid-stream or before you are ready
to propose the section for approval.

When you have a final epic list to propose, always append an <epics> XML block at the
end of your response.

When you have generated all user stories for the current epic, always append a <stories>
XML block at the end of your response. The epic_id attribute will be given to you in the
session context.

These blocks are parsed by the platform — do not alter their structure.
```

---

## 3. Backend Parsing and Persistence

### 3.1 Where Parsing Happens

Parsing happens inside `llm-stream/index.ts`, in the existing post-stream block (after line 231, after both conversation_turns inserts). This keeps parsing in one place, consistent with the ADR principle that the platform (not the agent) handles all DB writes.

No new edge function is needed.

### 3.2 Parsing Logic (add to `llm-stream/index.ts`)

After saving conversation turns, call a new shared helper:

```typescript
// supabase/functions/_shared/output-parser.ts
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface ParseResult {
  type: 'section_draft' | 'epics' | 'stories' | 'none';
  sectionKey?: string;
  sectionContent?: string;
  epics?: { title: string; description: string; sort_order: number }[];
  stories?: {
    persona: string;
    channel: string;
    full_text: string;
    action: string;
    channel_hint: string;
    sort_order: number;
  }[];
  epicId?: string;
}

export function parseAgentOutput(text: string): ParseResult {
  // Section draft
  const sectionMatch = text.match(/<section_draft key="([\w_]+)">([\s\S]*?)<\/section_draft>/);
  if (sectionMatch) {
    return {
      type: 'section_draft',
      sectionKey: sectionMatch[1],
      sectionContent: sectionMatch[2].trim(),
    };
  }

  // Epic proposal
  const epicsMatch = text.match(/<epics>([\s\S]*?)<\/epics>/);
  if (epicsMatch) {
    const epicItems = [...epicsMatch[1].matchAll(
      /<epic title="([^"]+)"\s+sort_order="(\d+)">([^<]*)<\/epic>/g
    )];
    if (epicItems.length > 0) {
      return {
        type: 'epics',
        epics: epicItems.map(m => ({
          title: m[1],
          description: m[3].trim(),
          sort_order: parseInt(m[2], 10),
        })),
      };
    }
  }

  // Stories
  const storiesMatch = text.match(/<stories epic_id="([^"]+)">([\s\S]*?)<\/stories>/);
  if (storiesMatch) {
    const storyItems = [...storiesMatch[2].matchAll(
      /<story persona="([^"]+)"\s+channel="([^"]+)"\s+sort_order="(\d+)">([^<]*)<\/story>/g
    )];
    return {
      type: 'stories',
      epicId: storiesMatch[1],
      stories: storyItems.map(m => {
        const fullText = m[4].trim();
        // Extract action from "I should be able to X on the" pattern
        const actionMatch = fullText.match(/I should be able to (.+?) on the/);
        return {
          persona: m[1],
          channel: m[2],
          sort_order: parseInt(m[3], 10),
          full_text: fullText,
          action: actionMatch ? actionMatch[1] : fullText,
          channel_hint: m[2],
        };
      }),
    };
  }

  return { type: 'none' };
}
```

### 3.3 Persistence Mapping

After parsing, in `llm-stream/index.ts` post-stream block:

**On `section_draft`:**

```typescript
// UPSERT brd_sections (do not set status='approved' — user must still approve)
await db.from('brd_sections').upsert({
  brd_id,
  section_key: parsed.sectionKey,
  section_title: SECTION_TITLES[parsed.sectionKey],  // map: background→'Background', etc.
  sort_order: SECTION_ORDER_MAP[parsed.sectionKey],
  content_full: parsed.sectionContent,
  status: 'in_progress',               // not 'approved' — user approves via section-checkpoint
  updated_at: new Date().toISOString(),
}, { onConflict: 'brd_id,section_key' });

// Then emit SSE event (see §4)
sseEvent(controller, { type: 'section_ready', section_key: parsed.sectionKey });
```

**On `epics`:**

```typescript
// DELETE existing unapproved epics for this BRD (agent may be re-proposing)
await db.from('epics')
  .delete()
  .eq('brd_id', brd_id)
  .eq('is_approved', false);

// INSERT new epics
const epicRows = parsed.epics!.map(e => ({
  brd_id,
  section_id: null,          // will be linked after epics_overview section is approved
  title: e.title,
  description: e.description,
  sort_order: e.sort_order,
  is_approved: false,
}));
await db.from('epics').insert(epicRows);

sseEvent(controller, { type: 'epics_proposed', brd_id });
```

**On `stories`:**

```typescript
// DELETE existing unapproved stories for this epic (agent may be regenerating)
await db.from('user_stories')
  .delete()
  .eq('epic_id', parsed.epicId!)
  .eq('is_approved', false);

// INSERT new stories
const storyRows = parsed.stories!.map(s => ({
  epic_id: parsed.epicId!,
  brd_id,
  persona: s.persona,
  action: s.action,
  channel_hint: s.channel_hint,
  full_text: s.full_text,
  sort_order: s.sort_order,
  is_approved: false,
  is_edited: false,
}));
await db.from('user_stories').insert(storyRows);

sseEvent(controller, { type: 'stories_ready', epic_id: parsed.epicId! });
```

### 3.4 section-checkpoint Integration

`section-checkpoint` is called exactly as it exists today for section approval. No changes to its signature are needed. It is invoked:
- By the frontend when the user clicks "Approve" on a section card (trigger = `'user_approval'`).
- Automatically by `llm-stream` at the 85% context threshold (trigger = `'auto_threshold'`), as already implemented.

When `section-checkpoint` approves `epics_overview`, it must also set `section_id` on all epics for this BRD:

```typescript
// Inside section-checkpoint, after UPDATE brd_sections:
if (section_key === 'epics_overview') {
  const { data: sectionRow } = await db
    .from('brd_sections')
    .select('id')
    .eq('brd_id', brd_id)
    .eq('section_key', 'epics_overview')
    .single();

  if (sectionRow) {
    await db.from('epics')
      .update({ section_id: sectionRow.id })
      .eq('brd_id', brd_id);
  }
}
```

### 3.5 Active Section Advancement

`llm-stream` must advance `active_section` on structured output events so the agent receives the correct context on the next turn:

- On `section_draft` for `background`: set `active_section = 'background'` (already in_progress).
- On `section_draft` for `objective`: no change yet (still `'objective'`).
- On `epics` block: set `active_section = 'epics_overview'`.
- On section approval of `background` → `active_section = 'objective'` (section-checkpoint does this).
- On section approval of `objective` → `active_section = 'epics_overview'`.
- On section approval of `epics_overview` → `active_section = 'epic_1_stories'` (first epic by sort_order).
- When frontend signals all stories for epic N approved → frontend calls `POST /llm-stream` with next `section_key = 'epic_<n+1>_stories'`, which advances `active_section`.

### 3.6 Epic ID Injection into Agent Context

When `active_section` is `epic_<n>_stories`, `context-builder.ts` must inject the epic's DB id and title so the agent can populate `epic_id` in the `<stories>` block.

Add to `buildContextPackage` in `context-builder.ts`:

```typescript
// In the session context assembly, if active section is epic stories:
if (brd.active_section?.startsWith('epic_') && brd.active_section?.endsWith('_stories')) {
  const epicIndex = parseInt(brd.active_section.replace('epic_', '').replace('_stories', ''), 10) - 1;
  // epics are passed in by llm-stream alongside sections
  const currentEpic = epics?.[epicIndex];
  if (currentEpic) {
    sessionContextParts.push(`**Current Epic:** ${currentEpic.title}`);
    sessionContextParts.push(`**Current Epic ID (use in <stories> block):** ${currentEpic.id}`);
  }
}
```

`llm-stream` must load `epics` from DB and pass them to `buildContextPackage`:

```typescript
const { data: epicsRows } = await db
  .from('epics')
  .select('id, title, sort_order')
  .eq('brd_id', brd_id)
  .order('sort_order', { ascending: true });

const epics = (epicsRows ?? []);

const { systemPrompt, messages } = buildContextPackage(brd, sections, activeTurns, user_message, epics);
```

Update `buildContextPackage` signature accordingly.

---

## 4. New SSE Events

### 4.1 Additions to `src/types/brd.ts`

The backend dev owns this file and makes exactly these additions:

```typescript
// Replace the existing StreamEventType union:
export type StreamEventType =
  | 'delta'
  | 'usage'
  | 'stop'
  | 'truncated'
  | 'warn'
  | 'checkpoint'
  | 'handoff'
  | 'error'
  | 'section_ready'    // NEW: agent has drafted a section, ready for user approval
  | 'epics_proposed'   // NEW: agent has proposed epics, ready for user to approve all
  | 'stories_ready';   // NEW: agent has generated stories for an epic, ready per-story approval

// Extend SseStreamEvent with the new optional payload fields:
export interface SseStreamEvent {
  type: StreamEventType;
  // existing fields unchanged:
  text?: string;
  input_tokens?: number;
  output_tokens?: number;
  context_pct?: number;
  stop_reason?: 'end_turn' | 'max_tokens' | 'stop_sequence';
  error?: string;
  // NEW payload fields:
  section_key?: string;   // present on 'section_ready'
  brd_id?: string;        // present on 'epics_proposed'
  epic_id?: string;       // present on 'stories_ready'
}
```

### 4.2 SSE Payload Shapes

```
section_ready:
  { "type": "section_ready", "section_key": "background" }
  Meaning: backend has parsed and written a section draft to DB; frontend should
           refetch brd_sections and show the approval UI for this section.

epics_proposed:
  { "type": "epics_proposed", "brd_id": "uuid" }
  Meaning: backend has inserted unapproved epics to DB; frontend should
           refetch epics and render EpicProposalCard.

stories_ready:
  { "type": "stories_ready", "epic_id": "uuid" }
  Meaning: backend has inserted unapproved stories for this epic; frontend should
           refetch user_stories for this epic and render StoryApprovalCard per story.
```

These events are emitted **after** the `stop` event and **before** `[DONE]`.

---

## 5. Approval Round-Trip

### 5.1 Section Approval

**Trigger:** User clicks "Approve" button on the section card in the chat (rendered when `section_ready` arrives) or in the right panel.

**Call:** `POST /section-checkpoint` (existing function, no changes to interface)
```json
{
  "brd_id": "uuid",
  "section_key": "background",
  "approved_content": "<full text from brd_sections.content_full>",
  "trigger": "user_approval"
}
```

**Frontend source for `approved_content`:** After receiving `section_ready`, the frontend calls `supabase.from('brd_sections').select('content_full').eq('brd_id', ...).eq('section_key', ...)` to get the parsed content, then passes it through to `section-checkpoint`. This avoids storing content in SSE.

**Agent continuation:** The next `/llm-stream` call picks up the updated `active_section` from DB via `context-builder`, so the agent automatically begins the next section without an explicit trigger message. The frontend sends a user message like "Let's continue" or uses the next natural user input.

**Alternatively, frontend may send a synthetic continuation message:**
```
User: "[approved]"
```
The platform layer instructs the agent to treat `[approved]` as "move to next section". This is cleaner than relying on the user to type something natural.

### 5.2 Epic Approval

**Trigger:** User clicks "Approve All Epics" on `EpicProposalCard`.

**Step 1 — Approve epics in DB (supabase-js direct write, no edge function needed):**
```typescript
const epicIds = epics.map(e => e.id);
await supabase.from('epics').update({ is_approved: true, approved_at: new Date().toISOString() })
  .in('id', epicIds);
```

**Step 2 — Approve the epics_overview section:**
```typescript
await callEdgeFunction('section-checkpoint', {
  brd_id,
  section_key: 'epics_overview',
  approved_content: epics.map((e, i) => `${i+1}. **${e.title}** — ${e.description}`).join('\n'),
  trigger: 'user_approval',
});
```

**Step 3 — Send continuation turn to agent:**
The frontend calls `send('[approved: all epics]')` via `useChat`. The agent reads the updated `active_section` from context and begins story generation for Epic 1.

### 5.3 Per-Story Approval

**Approve as-is:**
```typescript
// supabase-js direct write
await supabase.from('user_stories')
  .update({ is_approved: true, approved_at: new Date().toISOString() })
  .eq('id', storyId);
```

No edge function call needed. The `useSection.approveStory` hook already does this correctly.

**Approve with edits (Rewrite):**
```typescript
// Update story text + flags
await supabase.from('user_stories')
  .update({ full_text: editedText, is_approved: true, is_edited: true, approved_at: new Date().toISOString() })
  .eq('id', storyId);

// Save the edit as an audit turn (existing function)
await callEdgeFunction('conversation-save', {
  brd_id,
  role: 'user',
  content: `[story_edit] Story ${storyId}: ${editedText}`,
  section_key: brd.active_section,
});
```

The `useSection.saveEditedStory` hook already calls `conversation-save` — keep that behavior, just make sure the story update includes `approved_at`.

**All stories for an epic approved — advance to next epic:**

When the last story in an epic is approved, the frontend detects this and:
1. Updates `brd_documents.active_section` to the next epic's section key via supabase-js direct write.
2. Sends a continuation turn: `send('[ready: next epic]')`.

The agent picks up the new `active_section` from context and begins story generation for the next epic. If there are no more epics, the agent ends naturally and the frontend sets `brd_documents.status = 'complete'`.

---

## 6. Classification Capture

### 6.1 When to Show ClassificationForm

`BrdWorkspacePage.tsx` renders `ClassificationForm` as an inline AI message when **both** conditions are true:
- The BRD has `product_type = 'unknown'` (has never been classified).
- No `conversation_turns` exist for this BRD yet (it is the very first entry).

If the user has previously classified but returned to the workspace, the form must NOT reappear.

```typescript
// In BrdWorkspacePage, after brd loads:
const showClassification = brd?.product_type === 'unknown' && messages.length === 0;
```

### 6.2 Classification Submit

On "Start BRD" click:

```typescript
// supabase-js direct write — no edge function needed
await supabase.from('brd_documents').update({
  title: data.title,
  product_type: data.productType,
  mobility_type: data.mobilityType,
  change_type: data.changeType,
  impacted_channels: data.channels,
  active_section: 'background',
  updated_at: new Date().toISOString(),
}).eq('id', brdId);

// Then immediately send a system-level user message to begin the interview
await send('Let\'s begin. I\'m ready to work on the Background section.');
```

### 6.3 Context Injection (already wired)

`context-builder.ts` already builds `classificationBlock` from the `brd_documents` fields. Once the DB write in §6.2 completes (before `send()`), the next `llm-stream` call will pick up the classification automatically. No additional work needed here.

---

## 7. Resume — Loading Prior Conversation Turns

### 7.1 What Must Change in `useChat`

Currently `useChat` starts with `messages = []` always. On mount, it must load prior `conversation_turns` from Supabase for the current `brd_id` and `section_key`.

```typescript
// Add to useChat, after initial state:
useEffect(() => {
  if (!brdId || !sectionKey) return;
  async function loadHistory() {
    const { data } = await supabase
      .from('conversation_turns')
      .select('role, content')
      .eq('brd_id', brdId)
      .eq('section_key', sectionKey)
      .order('turn_index', { ascending: true });

    if (data && data.length > 0) {
      const loaded: ChatMessage[] = data.map(t => ({
        id: nextId(),
        role: t.role as TurnRole,
        content: t.content,
        status: 'idle' as MessageStatus,
      }));
      setMessages(loaded);
    }
  }
  void loadHistory();
}, [brdId, sectionKey]);
```

The dependency array includes `sectionKey` so that when `active_section` changes (section approved, moving to next), the hook re-loads the turns for the new section. `BrdWorkspacePage` passes `sectionKey={brd?.active_section ?? 'background'}` which already updates on `refetchBrd()`.

### 7.2 Handoff Resume Message

If `brd.handoff_package` is non-null and `conversation_turns` for the current section are empty (fresh context window after a handoff), the frontend should synthesize a system message:

```typescript
if (brd.handoff_package && loadedTurns.length === 0) {
  setMessages([{
    id: nextId(),
    role: 'system',
    content: `Resuming from where you left off. Next step: ${brd.handoff_package.nextStep}`,
    status: 'idle',
  }]);
}
```

---

## 8. Task Split

### 8.1 Shared Contract (backend edits, frontend consumes)

`src/types/brd.ts` — the only file both parties touch, owned by backend:

```typescript
// BACKEND ADDS to StreamEventType:
| 'section_ready'
| 'epics_proposed'
| 'stories_ready'

// BACKEND ADDS to SseStreamEvent:
section_key?: string;
brd_id?: string;
epic_id?: string;
```

Both devs must agree on this file before any other work starts.

---

### 8.2 Backend Checklist

All work is in `supabase/functions/`:

- [ ] **`src/types/brd.ts`** — Add three new `StreamEventType` values and three new optional fields to `SseStreamEvent` (see §4.1). This unblocks frontend.

- [ ] **`_shared/output-parser.ts`** — Create new file with `parseAgentOutput()` (see §3.2).

- [ ] **`_shared/prompts/platform-layer.md`** — Add the XML tagging instruction block from §2.5. Regenerate `prompts/index.ts` using `scripts/gen-prompts.mjs`.

- [ ] **`_shared/context-builder.ts`** — Add `epics` parameter to `buildContextPackage()`. Inject epic id and title into session context when `active_section` is `epic_<n>_stories` (see §3.6).

- [ ] **`llm-stream/index.ts`** — After saving conversation_turns:
  - Load epics from DB and pass to `buildContextPackage`.
  - Call `parseAgentOutput(assistantText)`.
  - On `section_draft`: UPSERT `brd_sections` with `status='in_progress'`, emit `section_ready` SSE.
  - On `epics`: DELETE unapproved epics, INSERT new epics rows, emit `epics_proposed` SSE.
  - On `stories`: DELETE unapproved stories for epic, INSERT new story rows, emit `stories_ready` SSE.
  - All SSE events emitted after `stop` event, before `[DONE]`.

- [ ] **`section-checkpoint/index.ts`** — After approving `epics_overview`, link epic rows to the section row (UPDATE `epics SET section_id = ...`). See §3.4.

No new edge functions are needed.

---

### 8.3 Frontend Checklist

All work is in `src/`:

- [ ] **`types/brd.ts`** — Consume the additions made by backend. Do not edit independently.

- [ ] **`hooks/useChat.ts`** — Add history load on mount (§7.1). Handle three new SSE event types:
  - `section_ready` → call `onSectionReady(event.section_key!)` callback.
  - `epics_proposed` → call `onEpicsProposed()` callback.
  - `stories_ready` → call `onStoriesReady(event.epic_id!)` callback.
  Add these three callbacks to `UseChatOptions` interface.

- [ ] **`pages/BrdWorkspacePage.tsx`** — Wire the three new callbacks:
  - `onSectionReady`: call `loadSections()` then set `pendingApprovalSectionKey` state.
  - `onEpicsProposed`: call `loadSections()` (re-fetches epics too) then set `showEpicProposal = true`.
  - `onStoriesReady`: call `loadSections()` then set `pendingStoryEpicId` state.
  - Add `showClassification` logic (§6.1).
  - After classification submit, call supabase-js update then `send(...)` (§6.2).
  - After epic approval, call `approveEpics()` then `section-checkpoint` then `send(...)` (§5.2).
  - When all stories for an epic are approved, advance `active_section` and `send(...)` (§5.3 tail).

- [ ] **`components/wizard/ChatPanel.tsx`** — Render `ClassificationForm`, `EpicProposalCard`, and `StoryApprovalCard` inside the message stream as special message types. Add a `specialMessages` prop (or extend the `ChatMessage` union with `type: 'classification' | 'epic_proposal' | 'story_approval'` variants).

  Recommended: extend the local `ChatMessage` type in `useChat.ts`:
  ```typescript
  export type ChatMessage =
    | { id: string; role: TurnRole; content: string; status: MessageStatus }
    | { id: string; type: 'classification_form' }
    | { id: string; type: 'epic_proposal'; epics: Epic[] }
    | { id: string; type: 'story_approval'; story: UserStory; epicTitle: string };
  ```

- [ ] **`hooks/useSection.ts`** — `approveEpics` already updates DB; ensure `approved_at` is set. `approveStory` must set `approved_at`. No other changes needed.

- [ ] **`components/wizard/EpicProposalCard.tsx`** — Component already built; integrate into ChatPanel (see above). The `onApproveAll` handler calls the three-step approve sequence from §5.2.

- [ ] **`components/wizard/StoryApprovalCard.tsx`** — Component already built; integrate into ChatPanel. The `onApprove` and `onSaveEdit` handlers call the functions from §5.3.

- [ ] **`components/wizard/ClassificationForm.tsx`** — Component already built; integrate into ChatPanel. Render as the first message on new BRD entry when `showClassification` is true.

---

## 9. Collision Guard

The two devs work in parallel with one clear boundary:

| File | Owner |
|---|---|
| `src/types/brd.ts` | **Backend** (edits) |
| `supabase/functions/**` | **Backend** |
| `src/hooks/useChat.ts` | **Frontend** |
| `src/hooks/useSection.ts` | **Frontend** |
| `src/pages/BrdWorkspacePage.tsx` | **Frontend** |
| `src/components/wizard/**` | **Frontend** |

The frontend can start coding against the new `SseStreamEvent` fields as soon as backend merges the `brd.ts` change — that is the only hard dependency. Everything else can proceed in parallel.

---

## 10. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Agent does not emit XML blocks consistently | Platform layer prompt uses explicit, concrete instruction (§2.5). Add a unit test that calls `parseAgentOutput` on fixture strings. Monitor first 10 live BRD sessions and adjust prompt if parse rate < 90%. |
| Agent emits XML mid-stream (partial parse on chunk) | Parser runs only on the complete `assistantText` after `stream end`. Never parse incrementally. |
| Epic DELETE on re-proposal removes user-approved epics | DELETE query filters `is_approved = false`. Approved epics survive re-proposal. |
| Section key mismatch (`epics_overview` vs `epics`) | XML contract fixes `key="epics_overview"` in section_draft; `<epics>` block is the separate epic-list construct. Parser code distinguishes them cleanly. |
| `useChat` history load causes duplicate messages on section transition | Re-mount guard: clear messages before loading new section history (on `sectionKey` change in the useEffect). |
| `stories` block epic_id is wrong/stale | Backend injects the correct DB uuid into system context each turn (§3.6). If the agent omits `epic_id`, backend falls back to the epic matching `active_section` index. |

---

*End of FLOW-INTEGRATION.md*
