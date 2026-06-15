# BRD Wizard — UI/UX Specification

**Version:** 1.0
**Date:** 2026-06-14
**Status:** Approved for MVP implementation
**Audience:** React frontend developers

---

## 0. Constraints and Assumptions

- Platform: Web SPA (React + Vite + TypeScript)
- Component library: **shadcn/ui** (see Section 3 for justification)
- All UI copy is in English; AI-generated BRD content may be in Turkish (pass-through)
- Breakpoints: desktop-first; min supported viewport 1280px wide. Tablet/mobile are read-only (no wizard editing on small screens — warn user)
- Streaming is via SSE (EventSource); the UI must handle partial text gracefully
- Context thresholds drive three distinct UI hint states (70% / 85% / 90%)
- Auth is Supabase username-as-email + password for MVP

---

## 1. Screen Inventory

### 1.1 Screens

| # | Screen | Route | Auth required |
|---|---|---|---|
| S1 | Login | `/login` | No |
| S2 | Documents Dashboard | `/` | Yes |
| S3 | BRD Wizard Workspace | `/brd/:id` | Yes (owner or public viewer) |
| S4 | Admin — Channel Editor | `/admin/channels` | Yes (role = admin) |

---

### S1 — Login

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                    ┌──────────────────────┐                     │
│                    │  BRD Wizard          │  ← logo/wordmark   │
│                    │  Vodafone Turkey CBU │                     │
│                    └──────────────────────┘                     │
│                                                                 │
│              ┌──────────────────────────────────┐              │
│              │  Username                        │              │
│              │  ┌────────────────────────────┐  │              │
│              │  │ user@vodafone.com.tr        │  │              │
│              │  └────────────────────────────┘  │              │
│              │                                  │              │
│              │  Password                        │              │
│              │  ┌────────────────────────────┐  │              │
│              │  │ ••••••••••••               │  │              │
│              │  └────────────────────────────┘  │              │
│              │                                  │              │
│              │  ┌────────────────────────────┐  │              │
│              │  │       Sign In              │  │  ← primary   │
│              │  └────────────────────────────┘  │              │
│              │                                  │              │
│              │  [!] Invalid credentials         │  ← error     │
│              └──────────────────────────────────┘              │
│                                                                 │
│              Internal tool — Vodafone Turkey, CBU Team          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**States:**
- Default: empty form, Sign In button enabled
- Loading: button shows spinner, inputs disabled
- Error: red inline message below button ("Invalid username or password")
- Success: redirect to `/`

---

### S2 — Documents Dashboard

```
┌─────────────────────────────────────────────────────────────────┐
│  BRD Wizard          [My BRDs]  [All Public]      [User ▾]      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  My BRDs                               [+ New BRD]             │
│                                                                 │
│  ┌─────────────────────────────┐  ┌─────────────────────────┐  │
│  │ CRM Billing Revamp          │  │ New SIM Activation Flow │  │
│  │ Postpaid · Mobile · Change  │  │ Prepaid · Mobile · New  │  │
│  │ Channels: SOT, FAST, TOBI   │  │ Channels: SOT, IVR      │  │
│  │                             │  │                         │  │
│  │ ● Draft — 2 epics           │  │ ✓ Complete              │  │
│  │ Last edited: Jun 13, 2026   │  │ Jun 10, 2026            │  │
│  │                             │  │                         │  │
│  │ [Continue]   [•••]          │  │ [Open]  [Export Word]   │  │
│  └─────────────────────────────┘  └─────────────────────────┘  │
│                                                                 │
│  ┌─────────────────────────────┐                               │
│  │ Untitled BRD                │                               │
│  │ Not classified              │                               │
│  │                             │                               │
│  │ ● Draft — not started       │                               │
│  │ Jun 14, 2026                │                               │
│  │                             │                               │
│  │ [Continue]   [•••]          │                               │
│  └─────────────────────────────┘                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**BRD Card states:**
- Draft (incomplete): amber dot + "Draft", shows "Continue" CTA
- Complete: green checkmark, shows "Open" + "Export Word"
- Overflow menu (•••): Rename / Toggle Public/Private / Delete

**Empty state (no BRDs):**
```
    ┌──────────────────────────────────┐
    │  No BRDs yet.                    │
    │  Start by creating a new one.    │
    │                                  │
    │        [+ New BRD]               │
    └──────────────────────────────────┘
```

**"All Public" tab:** Same card grid, read-only cards (no Edit/Delete), owner name shown.

---

### S3 — BRD Wizard Workspace (Primary Screen)

This is the core two-pane layout. The split is fixed at 55% left / 45% right on 1280px+.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  ← Dashboard   CRM Billing Revamp                    [Generate BRD ▾]  [≡ User]│
├────────────────────────────────────┬────────────────────────────────────────────┤
│  CHAT                              │  APPROVED SECTIONS                         │
│                                    │                                            │
│  ┌──────────────────────────────┐  │  ┌──────────────────────────────────────┐  │
│  │ AI                           │  │  │ ▼ Background                   ✓     │  │
│  │ Hello! I'm your BRD          │  │  │   CRM Billing Revamp requires a new  │  │
│  │ assistant. What would you    │  │  │   invoice viewing feature to …       │  │
│  │ like to document today?      │  │  └──────────────────────────────────────┘  │
│  │                              │  │                                            │
│  │ You can also attach a Word   │  │  ┌──────────────────────────────────────┐  │
│  │ document for context.        │  │  │ ▼ Objective                    ✓     │  │
│  └──────────────────────────────┘  │  │   Enable store employees to view     │  │
│                                    │  │   subscriber invoices on SOT …       │  │
│  ┌──────────────────────────────┐  │  └──────────────────────────────────────┘  │
│  │ You                          │  │                                            │
│  │ We need to allow store       │  │  ┌──────────────────────────────────────┐  │
│  │ employees to view subscriber │  │  │ ► Epics                              │  │
│  │ invoices on the SOT channel. │  │  │                                      │  │
│  └──────────────────────────────┘  │  │  ┌────────────────────────────────┐  │  │
│                                    │  │  │ Epic 1: Invoice Viewing   ✓    │  │  │
│  ┌──────────────────────────────┐  │  │  │  ● Story 1   ✓                 │  │  │
│  │ AI                (typing…) │  │  │  │  ● Story 2   ✓                 │  │  │
│  │ Great. Let me ask a few      │  │  │  │  ● Story 3   pending           │  │  │
│  │ questions to classify this   │  │  │  └────────────────────────────────┘  │  │
│  │ BRD…                         │  │  │                                      │  │
│  └──────────────────────────────┘  │  │  ┌────────────────────────────────┐  │  │
│                                    │  │  │ Epic 2: Permission Controls    │  │  │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │  │  │  (awaiting approval)           │  │  │
│  [!] Context 72% full — consider  │  │  └────────────────────────────────┘  │  │
│      finishing the current section.│  └──────────────────────────────────────┘  │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │                                            │
│                                    │                                            │
│  ┌──────────────────────────────┐  │                                            │
│  │ Type your message…      [📎] │  │                                            │
│  │                              │  │                                            │
│  │                    [Send →]  │  │                                            │
│  └──────────────────────────────┘  │                                            │
└────────────────────────────────────┴────────────────────────────────────────────┘
```

**Note on classification:** The first time a user sends their initial message, the classification form expands inline in the chat (see Section 4, Flow 1). It is not a separate modal.

---

### S4 — Admin Channel Editor

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Dashboard   Admin — Channel Management                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Impacted Channels                              [+ Add Channel] │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Code        Label           Order   Active   Actions   │   │
│  │  ──────────────────────────────────────────────────────│   │
│  │  SIEBEL      Siebel           1      [●]      [Edit]   │   │
│  │  SOT         SOT              2      [●]      [Edit]   │   │
│  │  FAST        FAST             3      [●]      [Edit]   │   │
│  │  C2D         C2D              4      [●]      [Edit]   │   │
│  │  IVR         IVR              5      [●]      [Edit]   │   │
│  │  TOBI        TOBI             6      [●]      [Edit]   │   │
│  │  VF_YANIMDA  VF Yanımda       7      [●]      [Edit]   │   │
│  │  WEB         Web              8      [●]      [Edit]   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Inline edit row** (on [Edit] click):
```
│  SOT  │  [SOT_________]  │  [SOT_______]  │  [2_]  │  [●]  │  [Save] [Cancel]  │
```

Active toggle is a Switch component. Inactive channels are visually dimmed and will not appear in the ChannelPicker in the wizard.

---

## 2. Component Breakdown — Wizard Screen

### 2.1 ChatPanel (left pane)

```
ChatPanel
├── MessageList
│   ├── MessageBubble (role: assistant)
│   │   ├── AvatarIcon (AI icon, 32×32)
│   │   ├── BubbleContent (markdown-rendered text)
│   │   └── StreamingCursor (animated, visible while streaming)
│   ├── MessageBubble (role: user)
│   │   ├── UserInitials (32×32 circle)
│   │   └── BubbleContent (plain text)
│   ├── ClassificationInlineForm (appears after first user message — see 2.2)
│   ├── EpicProposalCard (appears when AI proposes epic list — see 2.3)
│   ├── StoryApprovalCard (appears per story — see 2.4)
│   └── ContextHintBanner (conditionally rendered — see 2.6)
├── ChatInput
│   ├── Textarea (auto-grows, max 4 rows, Enter to send, Shift+Enter newline)
│   ├── AttachButton (📎 icon, accepts .docx only, max 10 MB)
│   ├── AttachedFileChip (shows filename + remove ×)
│   └── SendButton (disabled while streaming or empty)
└── TruncatedWarning (shown when stop_reason === "max_tokens")
```

**MessageBubble states:**

| State | Visual |
|---|---|
| Idle (assistant) | White bubble, left-aligned, subtle left border in brand blue |
| Idle (user) | Light gray bubble, right-aligned |
| Streaming | Same as idle-assistant + blinking cursor appended to text |
| Error | Red-tinted bubble, error icon, "Something went wrong. Try again." |
| Truncated | Amber border, "Response was cut off — [Continue?]" link at bottom |

**Streaming behavior:** Text is appended character-by-character to the active bubble. The MessageList scrolls to bottom automatically unless the user has manually scrolled up (detect scroll position before auto-scroll).

---

### 2.2 ClassificationInlineForm

Appears in the chat stream as an AI message with an embedded form card. The user fills it out (all fields optional) and clicks "Start BRD" to submit.

```
┌────────────────────────────────────────────────────────┐
│ AI                                                     │
│ Before we begin, set a few optional parameters.       │
│ You can skip any of these.                            │
│                                                        │
│ ┌────────────────────────────────────────────────────┐ │
│ │  BRD Title                                         │ │
│ │  [CRM Billing Revamp_______________________]       │ │
│ │                                                    │ │
│ │  Product Type                                      │ │
│ │  ( ) Prepaid   (●) Postpaid   ( ) Both             │ │
│ │                                                    │ │
│ │  Mobility                                          │ │
│ │  (●) Mobile    ( ) Fixed      ( ) Both             │ │
│ │                                                    │ │
│ │  Change Type                                       │ │
│ │  (●) New Product or Journey                        │ │
│ │  ( ) Change on Existing                            │ │
│ │                                                    │ │
│ │  Impacted Channels (select all that apply)         │ │
│ │  [Siebel] [SOT ×] [FAST ×] [C2D] [IVR]            │ │
│ │  [TOBI] [VF Yanımda] [Web]                         │ │
│ │                                                    │ │
│ │  Attach Word document (optional)                   │ │
│ │  [📎 Upload .docx]                                 │ │
│ │                                                    │ │
│ │         [Start BRD]                                │ │
│ └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

**Channel chips:** Toggle on/off. Active = filled brand-blue chip with white text and × dismiss icon. Inactive = outlined chip. Channels are loaded from the `channels` table (active only).

**Validation:** Title is required before submitting. Show inline error "Please enter a title" if blank.

---

### 2.3 EpicProposalCard

Appears as a special AI message when the AI has completed the Background + Objective sections and proposes the epic list.

```
┌────────────────────────────────────────────────────────┐
│ AI                                                     │
│ Based on our discussion, here are the proposed epics: │
│                                                        │
│ ┌─────────────────────────────────────────────────┐   │
│ │  Proposed Epics                                 │   │
│ │                                                 │   │
│ │  1.  Invoice Viewing                            │   │
│ │      Store employees view subscriber invoices   │   │
│ │      on SOT channel.                            │   │
│ │                                                 │   │
│ │  2.  Permission Management                      │   │
│ │      Role-based access control for billing      │   │
│ │      data visibility.                           │   │
│ │                                                 │   │
│ │  3.  Audit Trail                                │   │
│ │      Log all invoice access events.             │   │
│ │                                                 │   │
│ │   [Approve All Epics]   [Edit in Chat]          │   │
│ └─────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

"Edit in Chat" keeps the conversation going so the user can ask to remove, rename, or reorder epics. "Approve All Epics" calls `POST /section-checkpoint` for the epics overview section and moves all epics to the right panel as `is_approved = true`.

---

### 2.4 StoryApprovalCard

Appears per user story as the AI generates them one epic at a time.

```
┌────────────────────────────────────────────────────────┐
│ AI                                                     │
│ Here is a story for Epic 1 — Invoice Viewing:         │
│                                                        │
│ ┌─────────────────────────────────────────────────┐   │
│ │  User Story 1                                   │   │
│ │                                                 │   │
│ │  As a store employee, if I have permission,     │   │
│ │  I should be able to view the subscriber's      │   │
│ │  invoice on the SOT channel.                    │   │
│ │                                                 │   │
│ │   [Approve]   [Rewrite…]                        │   │
│ └─────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

**"Rewrite…" expands an inline textarea with the AI's text pre-populated:**

```
│ ┌─────────────────────────────────────────────────┐   │
│ │  Edit story text:                               │   │
│ │  ┌───────────────────────────────────────────┐  │   │
│ │  │ As a store employee, if I have permission │  │   │
│ │  │ I should be able to view the subscriber's │  │   │
│ │  │ invoice on the SOT channel.               │  │   │
│ │  └───────────────────────────────────────────┘  │   │
│ │   [Save My Version]   [Cancel]                  │   │
│ └─────────────────────────────────────────────────┘   │
```

"Save My Version" calls `POST /conversation-save` with the edited text and sets `is_edited = true` on the story row. Approved stories (AI or edited) move to the right panel immediately.

---

### 2.5 ApprovedPanel (right pane)

The right panel is a live document that fills up as the user approves content. It uses an accordion structure — sections collapse to a header once approved.

```
┌──────────────────────────────────────────┐
│  APPROVED SECTIONS                       │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │ ▼  Background              ✓    │    │  ← expanded
│  │    CRM Billing Revamp requires   │    │
│  │    a new invoice viewing         │    │
│  │    capability for store staff    │    │
│  │    to resolve subscriber         │    │
│  │    queries without escalation.   │    │
│  │                                  │    │
│  │    [Revise]                      │    │
│  └──────────────────────────────────┘    │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │ ►  Objective               ✓    │    │  ← collapsed
│  └──────────────────────────────────┘    │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │ ►  Epics                         │    │
│  │                                  │    │
│  │    ┌──────────────────────────┐  │    │
│  │    │ Epic 1: Invoice Viewing ✓│  │    │
│  │    │  1. As a store employee… │  │    │
│  │    │     ✓ approved           │  │    │
│  │    │  2. As a store employee… │  │    │
│  │    │     ✓ approved  ✏ edited │  │    │
│  │    │  3. (pending approval)   │  │    │
│  │    └──────────────────────────┘  │    │
│  │                                  │    │
│  │    ┌──────────────────────────┐  │    │
│  │    │ Epic 2: Permission Ctrl  │  │    │
│  │    │  (in progress)           │  │    │
│  │    └──────────────────────────┘  │    │
│  └──────────────────────────────────┘    │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │  [Generate BRD]                  │    │  ← sticky bottom
│  └──────────────────────────────────┘    │
└──────────────────────────────────────────┘
```

Section header states:
- Pending (gray): not yet reached in the flow
- In progress (blue ring): currently being worked
- Approved (green checkmark + ✓): locked, collapsible
- Revised (amber ring): reopened for edits

"Generate BRD" is always visible in the right panel footer. If the BRD is incomplete (any section still pending/in-progress), clicking it shows a warning: "Some sections are not yet complete. Export a partial BRD?" with [Export Anyway] and [Continue Working].

"Revise" on an approved section calls `PATCH /section-checkpoint` with `{ action: "reopen" }` and changes the section back to in_progress in the right panel.

---

### 2.6 ContextHintBanner

Appears inline between chat messages (not a toast, so it is not easily dismissed and missed).

**70% — soft hint:**
```
┌─────────────────────────────────────────────────────────────┐
│  ⚠  Context is 72% full. Consider wrapping up the current   │
│     section to keep things running smoothly.                │
│                                        [Finish Section]     │
└─────────────────────────────────────────────────────────────┘
```
Style: amber-tinted, left border amber-500, dismissible with ×.

**85% — auto-checkpoint (system message in chat):**
```
┌─────────────────────────────────────────────────────────────┐
│  System  The current section has been automatically saved   │
│          as a checkpoint. Continuing to the next section.   │
└─────────────────────────────────────────────────────────────┘
```
Style: gray system bubble, no dismiss, non-interactive.

**90% — session handoff:**
```
┌─────────────────────────────────────────────────────────────┐
│  System  Session limit reached. Your progress has been       │
│          saved. Return to this BRD and the AI will resume   │
│          from where you left off.                           │
│                                      [Go to Dashboard]      │
└─────────────────────────────────────────────────────────────┘
```
Style: blue system bubble, full-width, blocks further input (textarea disabled).

---

### 2.7 GenerateBRD Action

The [Generate BRD] button in the top-right header is a split button:
- Primary: "Generate BRD" → triggers POST /export-word → browser download
- Dropdown arrow → "Export partial BRD" (bypasses completeness check)

Loading state:
```
[Generating…  ⟳]
```
The button shows a spinner; all other controls remain active (the export is async, user can keep chatting).

---

## 3. Design System

### 3.1 Component Library — Recommendation: shadcn/ui

**Chosen: shadcn/ui** (with Radix UI primitives, styled via Tailwind CSS v3)

**Justification:**
- shadcn/ui copies components into the project as source code. There is no external dependency at runtime — no version lock-in, no bundle bloat from unused components.
- Built on Radix UI primitives: keyboard navigation, ARIA attributes, and focus management are handled at the primitive level. Every Dialog, Select, Toggle, and Accordion is accessible out of the box.
- Tailwind classes are the styling layer — the dev can override any token without fighting a CSS-in-JS cascade.
- Comparable alternatives: Mantine is feature-rich but heavyweight for an enterprise tool where brand control matters; Ant Design imposes strong opinionated styling that is hard to override. shadcn/ui wins on customisability and accessibility parity.

**Required shadcn/ui components to add via CLI:**
```
npx shadcn-ui@latest add button input textarea badge
npx shadcn-ui@latest add card accordion separator scroll-area
npx shadcn-ui@latest add dialog alert-dialog toast
npx shadcn-ui@latest add switch select label
npx shadcn-ui@latest add dropdown-menu avatar
```

---

### 3.2 Color Palette

Enterprise telecom internal tool. Professional, calm, high-contrast. Anchored to Vodafone's red as the brand accent used sparingly (primary actions only) against a neutral gray canvas.

| Token | Hex | HSL | Usage |
|---|---|---|---|
| `--color-brand` | `#E60000` | 0 100% 45% | Primary buttons, active chips, key CTAs |
| `--color-brand-hover` | `#C20000` | 0 100% 38% | Brand button hover state |
| `--color-brand-light` | `#FFF0F0` | 0 100% 97% | Active chip background tint |
| `--color-surface` | `#FFFFFF` | 0 0% 100% | Page and panel background |
| `--color-surface-muted` | `#F4F5F7` | 220 14% 96% | Right panel background, alternating rows |
| `--color-border` | `#DFE1E6` | 220 12% 88% | Card borders, dividers, input borders |
| `--color-text-primary` | `#1A1A2E` | 240 38% 14% | Body text, headings |
| `--color-text-secondary` | `#5E6278` | 231 14% 42% | Labels, meta text, timestamps |
| `--color-text-disabled` | `#A1A5B7` | 228 14% 66% | Disabled inputs, inactive chips |
| `--color-success` | `#1E8449` | 141 62% 32% | Approved checkmarks, success toasts |
| `--color-success-light` | `#EAFAF1` | 141 62% 96% | Approved section background tint |
| `--color-warning` | `#B7770D` | 38 85% 38% | Context hint banner, partial BRD warning |
| `--color-warning-light` | `#FEF9EC` | 45 100% 96% | Warning banner background |
| `--color-info` | `#1565C0` | 214 80% 42% | System messages, in-progress section ring |
| `--color-info-light` | `#E8F1FC` | 214 80% 95% | Info background tints |
| `--color-error` | `#C0392B` | 5 65% 46% | Error states, form validation |
| `--color-error-light` | `#FDEDEC` | 5 65% 97% | Error background tints |

**Contrast verification (WCAG AA):**
- `--color-text-primary` on `--color-surface`: 16.9:1 — AAA
- `--color-text-secondary` on `--color-surface`: 5.8:1 — AA
- `--color-brand` (#E60000) on white: 4.78:1 — AA (large text and UI components pass; do not use brand red for small body text)
- White text on `--color-brand`: 4.78:1 — AA for button labels (18px+, bold)
- `--color-text-disabled` on `--color-surface`: 2.3:1 — intentionally below contrast for decorative disabled state; never use for meaningful content

---

### 3.3 Typography

Font: **Inter** (Google Fonts). Fallback stack: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.

| Token | Size | Weight | Line-height | Usage |
|---|---|---|---|---|
| `text-xs` | 12px | 400 | 1.5 | Timestamps, meta labels |
| `text-sm` | 14px | 400 | 1.5 | Secondary body, chip labels, table cells |
| `text-base` | 16px | 400 | 1.6 | Chat message body, form fields, card text |
| `text-lg` | 18px | 500 | 1.4 | Card headings, section titles in right panel |
| `text-xl` | 20px | 600 | 1.3 | Page headings (Dashboard "My BRDs") |
| `text-2xl` | 24px | 700 | 1.25 | BRD title in workspace header |
| `font-mono` | 13px | 400 | 1.5 | Channel codes (SIEBEL, SOT) in admin table |

**Line length:** Chat bubble max-width is 85% of the panel. Right panel content is full-width within its section card. Target 60–80 characters per line for comfortable reading.

---

### 3.4 Spacing Scale (8-point grid)

| Token | Value | Common usage |
|---|---|---|
| `space-1` | 4px | Icon inner padding, chip gap |
| `space-2` | 8px | Chip padding-x, inline form gap |
| `space-3` | 12px | Message bubble padding |
| `space-4` | 16px | Card padding, input padding |
| `space-5` | 20px | Between messages |
| `space-6` | 24px | Section gap in right panel |
| `space-8` | 32px | Panel horizontal padding |
| `space-10` | 40px | Page-level vertical padding |

---

### 3.5 Shape and Elevation

| Element | Border radius | Shadow |
|---|---|---|
| Buttons | 6px | none |
| Cards / bubbles | 8px | `0 1px 3px rgba(0,0,0,0.10)` |
| Input fields | 6px | none (border only) |
| Modals / dialogs | 12px | `0 8px 24px rgba(0,0,0,0.14)` |
| Channel chips | 999px (pill) | none |
| Epic / story cards | 8px | `0 1px 3px rgba(0,0,0,0.08)` |
| Toast / banner | 6px | `0 2px 8px rgba(0,0,0,0.12)` |

---

### 3.6 Interactive States

| State | Treatment |
|---|---|
| Hover (button) | 8% darker background using brand-hover or gray-700 |
| Focus | 2px solid `--color-info`, 2px offset — never remove outline |
| Active (pressed) | 14% darker than rest state |
| Disabled | 40% opacity, cursor: not-allowed |
| Loading | Spinner replaces icon or appears left of label; pointer-events: none |

---

## 4. Key Interaction Flows

### Flow 1: First message and classification

```
User opens new BRD
      │
      ▼
AI sends greeting message (streaming)
"Hello! I'm your BRD assistant. What would you like to document today?"
      │
      ▼
User types initial topic, optionally attaches .docx → clicks Send
      │
      ▼
AI response: "Before we begin, set a few optional parameters." +
ClassificationInlineForm appears inside AI bubble
      │
      ▼
User fills form (title required, rest optional) → clicks "Start BRD"
      │
      ├─── Validates title is present
      │
      ▼
POST /llm-stream with brd_id (just created), user message, classification data
      │
      ▼
AI begins streaming clarifying question #1
(only ONE question per turn, per system prompt rules)
      │
      ▼
User answers → loop continues until AI has enough to propose epics
```

**Empty state for new BRD:** The right panel shows:
```
┌──────────────────────────────────────┐
│                                      │
│  Approved content will appear here   │
│  as you work through the sections.   │
│                                      │
└──────────────────────────────────────┘
```

---

### Flow 2: Epic approval

```
AI streams proposed epic list → EpicProposalCard renders
      │
      ├── User clicks "Approve All Epics"
      │         │
      │         ▼
      │   POST /section-checkpoint (epics_overview, user_approval)
      │   All epics → is_approved = true in DB
      │   Epics appear in right panel under Epics accordion
      │   AI immediately begins generating stories for Epic 1
      │
      └── User clicks "Edit in Chat"
                │
                ▼
          Chat continues (user types changes, AI revises list)
          EpicProposalCard stays visible with [Approve] re-enabled
```

---

### Flow 3: Per-story approval

```
For each story in current epic:
      │
      ▼
AI streams StoryApprovalCard
      │
      ├── User clicks "Approve"
      │         │
      │         ▼
      │   POST /conversation-save (story approved as-is)
      │   is_approved = true, is_edited = false
      │   Story appears in right panel under its epic with ✓
      │   AI immediately streams next story
      │
      └── User clicks "Rewrite…"
                │
                ▼
          Inline textarea opens with AI text pre-populated
                │
                ├── User edits → clicks "Save My Version"
                │         │
                │         ▼
                │   POST /conversation-save (edited text)
                │   is_approved = true, is_edited = true
                │   Story appears with ✓ ✏ (edited badge)
                │
                └── User clicks "Cancel"
                          │
                          ▼
                    Textarea collapses, original AI card restored
```

---

### Flow 4: Generate BRD (Word export)

```
User clicks "Generate BRD"
      │
      ├── If BRD is complete:
      │         │
      │         ▼
      │   Button → Loading state ("Generating… ⟳")
      │   POST /export-word { brd_id }
      │   On success: browser triggers download of BRD-<title>.docx
      │   Button returns to default state
      │
      └── If BRD is incomplete:
                │
                ▼
          AlertDialog: "Some sections are incomplete.
          Export a partial BRD?"
                │
                ├── [Export Anyway] → same as complete flow above
                └── [Continue Working] → dismiss dialog
```

---

### Flow 5: Resume incomplete BRD

```
User opens Dashboard
      │
      ▼
Draft BRD card shows "Continue" CTA
      │
      ▼
User clicks "Continue" → navigates to /brd/:id
      │
      ▼
Workspace loads:
  - Right panel: all previously approved sections restored from DB
  - Chat panel: empty (fresh context window)
  - If handoff_package exists: AI sends a resumption message (streamed):
    "Welcome back! We were working on [Epic 2 user stories]. Let's continue."
  - If no handoff_package: AI sends a summary-based resumption
      │
      ▼
User continues approving stories / sections
```

---

### Edge and Loading States

| State | Behaviour |
|---|---|
| Page load | Skeleton loaders for BRD cards on Dashboard; skeleton for right panel on Workspace |
| Stream starting (cold start) | Show "Thinking…" indicator in chat (3-dot pulse animation) immediately on Send, before first SSE delta arrives |
| Stream in progress | Text appends in real time; Send button disabled; scroll locked to bottom unless user scrolled up |
| Network error during stream | Error bubble in chat: "Connection lost. [Retry]". Retry re-sends the last user message. |
| Export loading | Button spinner; success triggers native browser download dialog |
| Export error | Toast: "Export failed. Try again." (error style) |
| File attachment too large | Inline error below attach button: "File exceeds 10 MB limit." |
| File attachment wrong type | Inline error: "Only .docx files are supported." |
| Context 70% | ContextHintBanner (amber) inline in chat |
| Context 85% | Auto-checkpoint system message in chat + right panel section marked Saved |
| Context 90% | Handoff system message, input disabled, dashboard CTA |

---

## 5. Accessibility

### 5.1 Keyboard Navigation

| Component | Behaviour |
|---|---|
| Login form | Tab order: username → password → sign in button |
| Dashboard cards | Cards are focusable; Enter/Space activates primary CTA |
| Chat textarea | Enter submits (configurable); Shift+Enter adds newline; Escape clears |
| Channel chips | Space/Enter toggles; chips are focusable radio/checkbox group |
| Classification radios | Standard arrow-key radio group navigation |
| Accordion (right panel) | Enter/Space expands/collapses; arrow keys move between headers |
| Dialog / AlertDialog | Focus trap while open; Escape closes; focus returns to trigger on close |
| Epic/Story approve buttons | Tab between [Approve] and [Rewrite…]; Enter/Space activates |
| Inline story textarea | Escape cancels; Tab moves to Save/Cancel buttons |

### 5.2 ARIA Requirements

- ChatPanel MessageList: `role="log"` with `aria-live="polite"` and `aria-atomic="false"` so screen readers announce new messages without re-reading the whole log
- Streaming cursor: `aria-hidden="true"` — purely decorative
- ClassificationInlineForm: standard form with `<label>` elements associated via `htmlFor`/`id`; radio groups wrapped in `<fieldset>` + `<legend>`
- ChannelPicker chip group: `role="group"` with `aria-label="Impacted Channels"`, each chip is a `<button role="checkbox">` with `aria-checked`
- ContextHintBanner: `role="alert"` for the 85% and 90% states (critical info); `role="status"` for the 70% hint
- Loading spinners: `aria-label="Loading"` + `aria-busy="true"` on their container
- EpicProposalCard and StoryApprovalCard: `role="region"` with descriptive `aria-label`

### 5.3 Focus Management

- On page navigation (Login → Dashboard → Workspace): focus moves to the page's main heading (`<h1>`)
- When ClassificationInlineForm appears: focus moves to the Title input
- When StoryApprovalCard appears: focus moves to the card's Approve button
- When inline story textarea opens on Rewrite: focus moves to the textarea
- After Approve/Save: focus returns to the ChatInput textarea so the user can continue typing

### 5.4 Color Independence

- Approval status is conveyed by both color (green) AND icon (✓ checkmark) AND text ("approved")
- In-progress sections use color (blue) AND a ring border AND text ("in progress")
- Error states use color (red) AND an error icon AND text description
- Never rely on color alone for any meaningful distinction

### 5.5 Touch Targets

All interactive elements (buttons, chips, accordion headers, message action icons) must meet a minimum 44×44px touch target. For icon-only buttons (attach, overflow menu), apply padding to reach 44×44 even if the visual icon is smaller.

---

## 6. Layout Specifications

### 6.1 Workspace Two-Pane Split

```
Viewport 1280px+:
  Left panel (ChatPanel): calc(55% - 1px)
  Divider: 1px solid --color-border
  Right panel (ApprovedPanel): 45%

Viewport 1024px–1279px:
  Left panel: 58%
  Right panel: 42%

Viewport < 1024px:
  Stacked layout (not supported for editing):
  Show banner: "BRD editing works best on a larger screen."
  Right panel hidden behind a [View BRD] floating button.
```

### 6.2 Workspace Header

Height: 56px. Fixed to top; panels scroll independently below it.

```
[← Dashboard]  [BRD Title (editable inline)]  ..spacer..  [Generate BRD ▾]  [User ▾]
```

BRD Title is an inline-editable field: click to edit, blur/Enter to save (PATCH brd_documents).

### 6.3 Chat Panel Internal Layout

- Header: 0 (no header inside panel, context is implied by workspace)
- MessageList: `flex-1 overflow-y-auto`, padding `space-6` horizontal, `space-5` between messages
- ContextHintBanner: rendered inline inside MessageList, not overlaid
- ChatInput: `height: auto` up to 4 rows (auto-grow), `min-height: 56px`, `padding: space-4`, border-top `1px solid --color-border`, sticky at panel bottom

### 6.4 Right Panel Internal Layout

- Header: "APPROVED SECTIONS" label, `text-xs`, `font-semibold`, uppercase, `letter-spacing: 0.08em`, color `--color-text-secondary`, `padding: space-6 space-6 space-4`
- Section list: `overflow-y-auto`, `padding: 0 space-6`
- Generate BRD footer: `padding: space-4 space-6`, `border-top: 1px solid --color-border`, sticky at panel bottom

---

## 7. Tailwind Config Extensions

Add to `tailwind.config.ts`:

```typescript
theme: {
  extend: {
    colors: {
      brand: {
        DEFAULT: '#E60000',
        hover:   '#C20000',
        light:   '#FFF0F0',
      },
      surface: {
        DEFAULT: '#FFFFFF',
        muted:   '#F4F5F7',
      },
      border:  '#DFE1E6',
      text: {
        primary:   '#1A1A2E',
        secondary: '#5E6278',
        disabled:  '#A1A5B7',
      },
      success: {
        DEFAULT: '#1E8449',
        light:   '#EAFAF1',
      },
      warning: {
        DEFAULT: '#B7770D',
        light:   '#FEF9EC',
      },
      info: {
        DEFAULT: '#1565C0',
        light:   '#E8F1FC',
      },
      error: {
        DEFAULT: '#C0392B',
        light:   '#FDEDEC',
      },
    },
    fontFamily: {
      sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
      mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
    },
    borderRadius: {
      chip: '999px',
    },
  },
},
```

---

## 8. Component File Map (aligned to ARCHITECTURE.md src/)

```
src/components/
├── auth/
│   └── LoginForm.tsx          — S1 login card, error state
├── dashboard/
│   ├── BrdList.tsx            — grid of BrdCards + empty state
│   └── BrdCard.tsx            — card with status badge, CTAs, overflow menu
├── wizard/
│   ├── WorkspaceHeader.tsx    — fixed 56px header, inline title edit
│   ├── ChatPanel.tsx          — left pane shell + scroll management
│   ├── MessageList.tsx        — aria-live log, auto-scroll logic
│   ├── MessageBubble.tsx      — user/assistant variants, streaming cursor
│   ├── ClassificationForm.tsx — inline form card inside AI bubble
│   ├── ChannelPicker.tsx      — chip group, loads from channels table
│   ├── EpicProposalCard.tsx   — approve-all / edit-in-chat
│   ├── StoryApprovalCard.tsx  — approve / rewrite inline textarea
│   ├── ContextHintBanner.tsx  — 70%/85%/90% variants
│   ├── ChatInput.tsx          — textarea, attach, send
│   ├── ApprovedPanel.tsx      — right pane shell
│   ├── SectionAccordion.tsx   — single section with revise button
│   ├── EpicBlock.tsx          — epic card with story list
│   └── StoryItem.tsx          — story row with approval + edited badge
├── admin/
│   └── ChannelTable.tsx       — CRUD table with inline edit rows
└── shared/
    ├── Spinner.tsx            — accessible spinner with aria-label
    ├── SkeletonCard.tsx       — loading placeholder
    ├── ConfirmDialog.tsx      — wraps shadcn AlertDialog
    └── StatusBadge.tsx        — draft/complete/in-progress badge chip
```

---

*End of UI/UX-SPEC.md*
