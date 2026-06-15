/**
 * Runtime settings loader — ADMIN-CONFIG.md §3
 *
 * Loads app_settings and active prompt_versions from DB once per Deno isolate
 * invocation. Results are cached in module-level variables with a 60-second TTL
 * so warm isolates pick up config changes without a cold start.
 *
 * SAFE FALLBACK: if the DB query fails, or if the tables don't exist yet (e.g.
 * migration hasn't been applied), all functions return the hardcoded defaults
 * that mirror the current codebase constants. Nothing in the app breaks.
 *
 * Phase-1 surface: context/turn settings + the 3 prompt texts.
 * (AI model/tokens and classification/file settings are Phase 2.)
 *
 * Usage in edge functions:
 *   import { getSettings, getPrompts } from '../_shared/settings.ts';
 *   const s = await getSettings(db);
 *   const p = await getPrompts(db);
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// Embedded prompts are always available as the fallback baseline.
import {
  platformLayerText,
  agentSkillText,
  channelMappingText,
} from './prompts/index.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Full settings shape covering all parameter groups.
 * Phase-1 integrations only read the context/turn fields; the rest are
 * present for completeness and Phase-2 wiring.
 */
export interface AppSettings {
  // Group 1: AI (Phase 2)
  ai_model_id: string;
  ai_stream_max_tokens: number;
  ai_complete_max_tokens: number;
  ai_temperature: number | null;
  // Group 2: Context & Turns (Phase 1)
  context_window_tokens: number;
  context_threshold_warn_pct: number;
  context_threshold_checkpoint_pct: number;
  context_threshold_handoff_pct: number;
  context_max_turns_per_section: number;
  // Group 3: Classification & Files (Phase 2)
  classification_product_types: string[];
  classification_mobility_types: string[];
  classification_change_types: string[];
  files_max_size_mb: number;
  files_accepted_types: string[];
}

/** Active prompt texts, one per key. */
export interface ActivePrompts {
  platform_layer: string;
  agent_skill: string;
  channel_mapping: string;
}

// ---------------------------------------------------------------------------
// Hardcoded defaults — mirrors current codebase constants exactly
// ---------------------------------------------------------------------------

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

const PROMPT_DEFAULTS: ActivePrompts = {
  platform_layer: platformLayerText,
  agent_skill: agentSkillText,
  channel_mapping: channelMappingText,
};

// ---------------------------------------------------------------------------
// Isolate-scope cache
// ---------------------------------------------------------------------------

let cachedSettings: AppSettings | null = null;
let cachedPrompts: ActivePrompts | null = null;
let cacheExpiresAt = 0;        // Unix ms
const CACHE_TTL_MS = 60_000;   // 60 seconds
const FAILURE_TTL_MS = 5_000;  // retry sooner after a DB failure

function isCacheValid(): boolean {
  return Date.now() < cacheExpiresAt &&
    cachedSettings !== null &&
    cachedPrompts !== null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the current AppSettings, loading from DB if the cache is stale.
 * Never throws — falls back to DEFAULTS on any error.
 */
export async function getSettings(db: SupabaseClient): Promise<AppSettings> {
  if (!isCacheValid()) await refreshCache(db);
  return cachedSettings!;
}

/**
 * Returns the current ActivePrompts, loading from DB if the cache is stale.
 * Never throws — falls back to embedded prompt texts on any error.
 */
export async function getPrompts(db: SupabaseClient): Promise<ActivePrompts> {
  if (!isCacheValid()) await refreshCache(db);
  return cachedPrompts!;
}

// ---------------------------------------------------------------------------
// Cache refresh
// ---------------------------------------------------------------------------

async function refreshCache(db: SupabaseClient): Promise<void> {
  // Always reset to defaults first so partial failures leave safe values.
  cachedSettings = { ...DEFAULTS };
  cachedPrompts = { ...PROMPT_DEFAULTS };

  try {
    // One round-trip: load all app_settings rows.
    const { data: settingRows, error: settingsError } = await db
      .from('app_settings')
      .select('key, value');

    if (!settingsError && settingRows) {
      for (const row of settingRows) {
        applySettingRow(cachedSettings, row.key, row.value);
      }
    } else if (settingsError) {
      // Table may not exist yet (migration pending) — not fatal.
      console.warn('[settings] app_settings query failed (using defaults):', settingsError.message);
    }

    // One round-trip: load all active prompt versions.
    // IMPORTANT: only a NON-default active version (an admin customization)
    // overrides the embedded prompt. When the active version is the default
    // (or there is none), we keep the EMBEDDED text so code-level prompt
    // improvements ship on deploy without being shadowed by a stale seed row.
    const { data: promptRows, error: promptError } = await db
      .from('prompt_versions')
      .select('prompt_key, content, is_default')
      .eq('is_active', true);

    if (!promptError && promptRows) {
      for (const row of promptRows) {
        if (row.is_default) continue; // default → use embedded (latest code)
        switch (row.prompt_key) {
          case 'platform_layer':  cachedPrompts.platform_layer  = row.content; break;
          case 'agent_skill':     cachedPrompts.agent_skill     = row.content; break;
          case 'channel_mapping': cachedPrompts.channel_mapping = row.content; break;
        }
      }
    } else if (promptError) {
      console.warn('[settings] prompt_versions query failed (using defaults):', promptError.message);
    }

    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  } catch (err) {
    // Unexpected error (network, env vars missing, etc.) — stay on defaults.
    console.warn('[settings] Failed to load settings from DB, using defaults:', err);
    cacheExpiresAt = Date.now() + FAILURE_TTL_MS;
  }
}

// ---------------------------------------------------------------------------
// Row applicator
// ---------------------------------------------------------------------------

function applySettingRow(s: AppSettings, key: string, value: unknown): void {
  switch (key) {
    // Group 1: AI
    case 'ai.model_id':
      if (typeof value === 'string') s.ai_model_id = value;
      break;
    case 'ai.stream_max_tokens':
      if (typeof value === 'number') s.ai_stream_max_tokens = value;
      break;
    case 'ai.complete_max_tokens':
      if (typeof value === 'number') s.ai_complete_max_tokens = value;
      break;
    case 'ai.temperature':
      s.ai_temperature = value === null ? null : Number(value);
      break;

    // Group 2: Context & Turns
    case 'context.window_tokens':
      if (typeof value === 'number') s.context_window_tokens = value;
      break;
    case 'context.threshold_warn_pct':
      if (typeof value === 'number') s.context_threshold_warn_pct = value;
      break;
    case 'context.threshold_checkpoint_pct':
      if (typeof value === 'number') s.context_threshold_checkpoint_pct = value;
      break;
    case 'context.threshold_handoff_pct':
      if (typeof value === 'number') s.context_threshold_handoff_pct = value;
      break;
    case 'context.max_turns_per_section':
      if (typeof value === 'number') s.context_max_turns_per_section = value;
      break;

    // Group 3: Classification & Files
    case 'classification.product_types':
      if (Array.isArray(value)) s.classification_product_types = value as string[];
      break;
    case 'classification.mobility_types':
      if (Array.isArray(value)) s.classification_mobility_types = value as string[];
      break;
    case 'classification.change_types':
      if (Array.isArray(value)) s.classification_change_types = value as string[];
      break;
    case 'files.max_size_mb':
      if (typeof value === 'number') s.files_max_size_mb = value;
      break;
    case 'files.accepted_types':
      if (Array.isArray(value)) s.files_accepted_types = value as string[];
      break;
  }
}
