/*
 * Shared domain types — mirror the Supabase schema in
 * docs/ARCHITECTURE.md §2 and supabase/migrations/0001_initial_schema.sql.
 * This is the contract both the frontend (src/) and the SSE/edge clients
 * build against. Keep in sync with the migration.
 */

export type BrdStatus = 'draft' | 'complete';
export type ReviewStage =
  | 'none'
  | 'compliance_running'
  | 'compliance_done'
  | 'maturity_running'
  | 'maturity_done';
export type WarningSource = 'kvkk' | 'data_privacy' | 'regulation' | 'maturity';
export type WarningStatus = 'open' | 'acknowledged' | 'rejected';
export type BrdVisibility = 'public' | 'private';
export type BrdLine = 'CBU';
export type ProductType = 'prepaid' | 'postpaid' | 'both' | 'unknown';
export type MobilityType = 'mobile' | 'fixed' | 'both' | 'unknown';
export type ChangeType = 'new' | 'change' | 'unknown';
export type SectionStatus = 'pending' | 'in_progress' | 'approved';
export type TurnRole = 'user' | 'assistant' | 'system';
export type UserRole = 'user' | 'admin';

export interface Channel {
  id: string;
  code: string;
  label: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface Profile {
  id: string;
  display_name: string | null;
  role: UserRole;
}

export interface BrdDocument {
  id: string;
  owner_id: string;
  title: string;
  business_line: BrdLine;
  product_type: ProductType;
  mobility_type: MobilityType;
  change_type: ChangeType;
  impacted_channels: string[];
  status: BrdStatus;
  visibility: BrdVisibility;
  active_section: string | null;
  context_token_pct: number;
  handoff_package: HandoffPackage | null;
  /** User-authored: expected business value / outcome. */
  expected_value: string | null;
  /** User-authored: free-form notes. */
  notes: string | null;
  /** User-authored: reporting requirements. */
  reports: string | null;
  /** Post-authoring review lifecycle. */
  review_stage: ReviewStage;
  compliance_batch_id: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A compliance (KVKK / Data Privacy / Regulation) or maturity review finding. */
export interface BrdWarning {
  id: string;
  brd_id: string;
  source: WarningSource;
  severity: string;
  target_type: 'section' | 'story' | 'brd';
  target_section_key: string | null;
  target_story_id: string | null;
  message: string;
  recommendation: string | null;
  status: WarningStatus;
  created_at: string;
}

export interface BrdSection {
  id: string;
  brd_id: string;
  section_key: string;
  section_title: string;
  sort_order: number;
  content_full: string | null;
  summary_line: string | null;
  status: SectionStatus;
  approved_at: string | null;
}

export interface Epic {
  id: string;
  brd_id: string;
  section_id: string | null;
  title: string;
  description: string | null;
  sort_order: number;
  is_approved: boolean;
}

export interface UserStory {
  id: string;
  epic_id: string;
  brd_id: string;
  persona: string | null;
  action: string;
  channel_hint: string | null;
  full_text: string;
  is_approved: boolean;
  is_edited: boolean;
  sort_order: number;
}

export interface ConversationTurn {
  id: string;
  brd_id: string;
  section_key: string | null;
  turn_index: number;
  role: TurnRole;
  content: string;
  input_tokens: number | null;
  output_tokens: number | null;
  context_pct: number | null;
  created_at: string;
}

export interface HandoffPackage {
  completedSections: { key: string; title: string; summaryLine: string }[];
  activeSection: string;
  partialWork: string;
  nextStep: string;
  openQuestions: string[];
  generatedAt: string;
}

/* ── SSE stream contract (from /llm-stream edge function) ── */
export type StreamEventType =
  | 'delta'
  | 'usage'
  | 'stop'
  | 'truncated'
  | 'warn'
  | 'checkpoint'
  | 'handoff'
  | 'error'
  // Structured-flow events (docs/FLOW-INTEGRATION.md): emitted after `stop`,
  // before [DONE], once the backend has parsed the agent's XML blocks and
  // persisted rows. The frontend refetches and renders the approval UI.
  | 'section_ready' // backend wrote a brd_sections draft → show section approval
  | 'epics_proposed' // backend inserted unapproved epics → render EpicProposalCard
  | 'stories_ready'; // backend inserted unapproved stories → render StoryApprovalCard

export interface SseStreamEvent {
  type: StreamEventType;
  text?: string;
  input_tokens?: number;
  output_tokens?: number;
  context_pct?: number;
  stop_reason?: 'end_turn' | 'max_tokens' | 'stop_sequence';
  error?: string;
  // Structured-flow payloads.
  section_key?: string; // section_ready
  brd_id?: string; // epics_proposed
  epic_id?: string; // stories_ready
}
