/**
 * /settings-admin — ADMIN-CONFIG.md §2, §4, §6
 *
 * Admin-only edge function for reading and writing runtime configuration.
 * All write operations are server-side validated before any DB mutation.
 *
 * Phase-1 surface:
 *   - app_settings: context & turn limit keys (5 rows)
 *   - prompt_versions: platform_layer, agent_skill, channel_mapping
 *
 * Routes (dispatched by method + URL path):
 *
 *   GET  /settings-admin
 *     Returns Phase-1 app_settings rows + all prompt_versions grouped by key.
 *     Admin only.
 *
 *   PATCH /settings-admin/setting
 *     Update one app_settings row.  Body: { key, value }
 *     Validates the value server-side; rejects with 400 on failure.
 *     Admin only.
 *
 *   POST /settings-admin/prompt
 *     Create a new (inactive) prompt_versions draft.
 *     Body: { prompt_key, content, label? }
 *     Admin only.
 *
 *   PATCH /settings-admin/prompt/:id/activate
 *     Activate a specific version (deactivates all others for that key).
 *     Special case: when prompt_key = 'agent_skill', validates {{CHANNEL_MAPPING}}
 *     placeholder is present before activating.
 *     Admin only.
 *
 *   PATCH /settings-admin/prompt/restore-default
 *     Body: { prompt_key }
 *     Activates the is_default=true row for the given key.
 *     Admin only.
 *
 * Auth: JWT required for all routes. Admin role enforced on every handler.
 */

import { corsPreflightResponse, withCors } from '../_shared/cors.ts';
import { verifyAuth, getServiceClient, requireAdmin } from '../_shared/supabase-client.ts';

// ---------------------------------------------------------------------------
// Validation constants (Phase 1 only)
// ---------------------------------------------------------------------------

const PHASE1_KEYS = new Set([
  'context.window_tokens',
  'context.threshold_warn_tokens',
  'context.threshold_checkpoint_tokens',
  'context.threshold_handoff_tokens',
  'context.max_turns_per_section',
]);

const VALID_PROMPT_KEYS = new Set(['platform_layer', 'agent_skill', 'channel_mapping']);

// ---------------------------------------------------------------------------
// Server-side validation
// ---------------------------------------------------------------------------

/**
 * Validates a single app_settings value for a given key.
 * Returns an error string, or null if valid.
 */
function validateSettingValue(key: string, value: unknown): string | null {
  switch (key) {
    case 'context.window_tokens': {
      if (!Number.isInteger(value) || (value as number) < 50_000 || (value as number) > 1_000_000)
        return 'window_tokens must be an integer between 50000 and 1000000';
      break;
    }
    case 'context.threshold_warn_tokens':
    case 'context.threshold_checkpoint_tokens':
    case 'context.threshold_handoff_tokens': {
      if (!Number.isInteger(value) || (value as number) < 10_000 || (value as number) > 1_000_000)
        return `${key} must be an integer between 10000 and 1000000`;
      break;
    }
    case 'context.max_turns_per_section': {
      if (!Number.isInteger(value) || (value as number) < 5 || (value as number) > 50)
        return 'max_turns_per_section must be an integer between 5 and 50';
      break;
    }
    default:
      return `Unknown or non-Phase-1 key: "${key}". Supported keys: ${[...PHASE1_KEYS].join(', ')}`;
  }
  return null;
}

/**
 * Cross-key threshold ordering check.
 * Returns an error string if warn >= checkpoint or checkpoint >= handoff; else null.
 */
function validateThresholdOrdering(warn: number, checkpoint: number, handoff: number): string | null {
  if (!(warn < checkpoint && checkpoint < handoff))
    return `Thresholds must be strictly ordered: warn (${warn}) < checkpoint (${checkpoint}) < handoff (${handoff})`;
  return null;
}

/**
 * Validates prompt content before insertion or activation.
 * Returns an error string, or null if valid.
 */
function validatePromptContent(_promptKey: string, content: unknown): string | null {
  if (typeof content !== 'string' || content.trim().length === 0)
    return 'content must be a non-empty string';
  if (content.length > 100_000)
    return 'content must be ≤ 100,000 characters';
  if (content.includes('\0'))
    return 'content must not contain null bytes';
  // Note: the {{CHANNEL_MAPPING}} placeholder is OPTIONAL for agent_skill — if
  // omitted, the platform appends the channel mapping automatically (see
  // context-builder.assembleAgentLayer). So we do NOT reject content without it.
  return null;
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCors({ 'Content-Type': 'application/json' }),
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

// ---------------------------------------------------------------------------
// GET /settings-admin — read Phase-1 settings + all prompt versions
// ---------------------------------------------------------------------------

async function handleGet(userId: string): Promise<Response> {
  // Admin only.
  try { await requireAdmin(userId); } catch (r) { return r as Response; }

  const db = getServiceClient();

  // Load Phase-1 app_settings rows.
  const { data: settingRows, error: settingsError } = await db
    .from('app_settings')
    .select('key, value, description, updated_at, updated_by')
    .in('key', [...PHASE1_KEYS]);

  if (settingsError) {
    console.error('[settings-admin] GET settings error:', settingsError);
    return err('Failed to fetch app_settings', 500);
  }

  // Load all prompt versions for the 3 Phase-1 keys. `content` is included so the
  // admin editor can display/preview/edit the active version directly.
  const { data: promptRows, error: promptError } = await db
    .from('prompt_versions')
    .select('id, prompt_key, version, content, is_active, is_default, label, created_at, created_by')
    .in('prompt_key', [...VALID_PROMPT_KEYS])
    .order('prompt_key', { ascending: true })
    .order('version', { ascending: false });

  if (promptError) {
    console.error('[settings-admin] GET prompts error:', promptError);
    return err('Failed to fetch prompt_versions', 500);
  }

  // Group prompt versions by key.
  const promptsByKey: Record<string, unknown[]> = {};
  for (const row of promptRows ?? []) {
    const k = row.prompt_key as string;
    if (!promptsByKey[k]) promptsByKey[k] = [];
    promptsByKey[k].push(row);
  }

  return json({
    settings: settingRows ?? [],
    prompts: promptsByKey,
  });
}

// ---------------------------------------------------------------------------
// PATCH /settings-admin/setting — update one app_settings row
// ---------------------------------------------------------------------------

async function handlePatchSetting(req: Request, userId: string): Promise<Response> {
  try { await requireAdmin(userId); } catch (r) { return r as Response; }

  let body: { key: string; value: unknown };
  try { body = await req.json(); } catch {
    return err('Invalid JSON body');
  }

  const { key, value } = body;

  if (!key || value === undefined)
    return err('key and value are required');

  if (!PHASE1_KEYS.has(key))
    return err(`Unknown or non-Phase-1 key: "${key}"`);

  // Individual validation.
  const valError = validateSettingValue(key, value);
  if (valError) return err(valError);

  const db = getServiceClient();

  // Cross-key threshold ordering check when updating any threshold.
  if (
    key === 'context.threshold_warn_tokens' ||
    key === 'context.threshold_checkpoint_tokens' ||
    key === 'context.threshold_handoff_tokens'
  ) {
    // Fetch the current values of all three thresholds.
    const { data: thresholdRows } = await db
      .from('app_settings')
      .select('key, value')
      .in('key', [
        'context.threshold_warn_tokens',
        'context.threshold_checkpoint_tokens',
        'context.threshold_handoff_tokens',
      ]);

    const current: Record<string, number> = {
      'context.threshold_warn_tokens': 300_000,
      'context.threshold_checkpoint_tokens': 500_000,
      'context.threshold_handoff_tokens': 800_000,
    };
    for (const row of thresholdRows ?? []) {
      current[row.key] = Number(row.value);
    }
    // Apply the incoming change.
    current[key] = value as number;

    const orderError = validateThresholdOrdering(
      current['context.threshold_warn_tokens'],
      current['context.threshold_checkpoint_tokens'],
      current['context.threshold_handoff_tokens'],
    );
    if (orderError) return err(orderError);
  }

  // Write to DB.
  const { error: upsertError } = await db
    .from('app_settings')
    .upsert(
      {
        key,
        value: value as never,  // JSONB
        updated_at: new Date().toISOString(),
        updated_by: userId,
      },
      { onConflict: 'key' },
    );

  if (upsertError) {
    console.error('[settings-admin] PATCH setting error:', upsertError);
    return err('Failed to update setting', 500);
  }

  return json({ success: true, key, value });
}

// ---------------------------------------------------------------------------
// PATCH /settings-admin/settings — update MANY app_settings rows atomically.
// One request, validated together (incl. final threshold ordering), upserted in
// a single call. Avoids the partial-save / transient-ordering issues of firing
// one request per field from the client.
// ---------------------------------------------------------------------------

async function handlePatchSettingsBulk(req: Request, userId: string): Promise<Response> {
  try { await requireAdmin(userId); } catch (r) { return r as Response; }

  let body: { updates?: Array<{ key: string; value: unknown }> };
  try { body = await req.json(); } catch {
    return err('Invalid JSON body');
  }

  const updates = body?.updates;
  if (!Array.isArray(updates) || updates.length === 0)
    return err('updates must be a non-empty array of { key, value }');

  // Validate each key + value individually.
  for (const u of updates) {
    if (!u || typeof u.key !== 'string' || u.value === undefined)
      return err('each update needs a key and a value');
    if (!PHASE1_KEYS.has(u.key))
      return err(`Unknown or non-Phase-1 key: "${u.key}"`);
    const ve = validateSettingValue(u.key, u.value);
    if (ve) return err(ve);
  }

  const db = getServiceClient();

  // Validate the FINAL threshold ordering once (current DB overlaid with all
  // incoming changes) — atomic, so no transient out-of-order state can be rejected.
  const touchesThreshold = updates.some((u) =>
    u.key === 'context.threshold_warn_tokens' ||
    u.key === 'context.threshold_checkpoint_tokens' ||
    u.key === 'context.threshold_handoff_tokens');

  if (touchesThreshold) {
    const { data: rows } = await db
      .from('app_settings')
      .select('key, value')
      .in('key', [
        'context.threshold_warn_tokens',
        'context.threshold_checkpoint_tokens',
        'context.threshold_handoff_tokens',
      ]);
    const cur: Record<string, number> = {
      'context.threshold_warn_tokens': 300_000,
      'context.threshold_checkpoint_tokens': 500_000,
      'context.threshold_handoff_tokens': 800_000,
    };
    for (const r of rows ?? []) cur[r.key] = Number(r.value);
    for (const u of updates) if (u.key in cur) cur[u.key] = u.value as number;
    const oe = validateThresholdOrdering(
      cur['context.threshold_warn_tokens'],
      cur['context.threshold_checkpoint_tokens'],
      cur['context.threshold_handoff_tokens'],
    );
    if (oe) return err(oe);
  }

  const now = new Date().toISOString();
  const { error: upErr } = await db.from('app_settings').upsert(
    updates.map((u) => ({
      key: u.key,
      value: u.value as never,
      updated_at: now,
      updated_by: userId,
    })),
    { onConflict: 'key' },
  );

  if (upErr) {
    console.error('[settings-admin] bulk PATCH error:', upErr);
    return err('Failed to update settings', 500);
  }

  return json({ success: true, count: updates.length });
}

// ---------------------------------------------------------------------------
// POST /settings-admin/prompt — create a new (inactive) prompt draft
// ---------------------------------------------------------------------------

async function handlePostPrompt(req: Request, userId: string): Promise<Response> {
  try { await requireAdmin(userId); } catch (r) { return r as Response; }

  let body: { prompt_key: string; content: string; label?: string };
  try { body = await req.json(); } catch {
    return err('Invalid JSON body');
  }

  const { prompt_key, content, label } = body;

  if (!prompt_key || !content)
    return err('prompt_key and content are required');

  if (!VALID_PROMPT_KEYS.has(prompt_key))
    return err(`Invalid prompt_key: "${prompt_key}". Must be one of: ${[...VALID_PROMPT_KEYS].join(', ')}`);

  const contentError = validatePromptContent(prompt_key, content);
  if (contentError) return err(contentError);

  const db = getServiceClient();

  // Determine the next version number for this key.
  const { data: maxVersionRow } = await db
    .from('prompt_versions')
    .select('version')
    .eq('prompt_key', prompt_key)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  const nextVersion = maxVersionRow ? (maxVersionRow.version as number) + 1 : 1;

  const { data: newRow, error: insertError } = await db
    .from('prompt_versions')
    .insert({
      prompt_key,
      version: nextVersion,
      content,
      is_active: false,
      is_default: false,
      label: label ?? null,
      created_by: userId,
    })
    .select('id, prompt_key, version, is_active, is_default, label, created_at')
    .single();

  if (insertError) {
    console.error('[settings-admin] POST prompt error:', insertError);
    return err('Failed to create prompt draft', 500);
  }

  return json({ prompt: newRow }, 201);
}

// ---------------------------------------------------------------------------
// PATCH /settings-admin/prompt/:id/activate — activate a specific version
// ---------------------------------------------------------------------------

async function handleActivatePrompt(req: Request, userId: string, versionId: string): Promise<Response> {
  try { await requireAdmin(userId); } catch (r) { return r as Response; }

  if (!versionId) return err('Version id is required in the URL path');

  const db = getServiceClient();

  // Fetch the target version to determine its prompt_key and validate content.
  const { data: targetRow, error: fetchError } = await db
    .from('prompt_versions')
    .select('id, prompt_key, content, is_active, is_default')
    .eq('id', versionId)
    .single();

  if (fetchError || !targetRow)
    return err('Prompt version not found', 404);

  const { prompt_key, content } = targetRow;

  // Validate the content before activation (catches corrupted drafts).
  const contentError = validatePromptContent(prompt_key as string, content);
  if (contentError) return err(`Cannot activate: ${contentError}`);

  // Atomic swap: deactivate all others for this key, activate the target.
  const { error: deactivateError } = await db
    .from('prompt_versions')
    .update({ is_active: false })
    .eq('prompt_key', prompt_key)
    .neq('id', versionId);

  if (deactivateError) {
    console.error('[settings-admin] activate deactivate error:', deactivateError);
    return err('Failed to deactivate other versions', 500);
  }

  const { data: activatedRow, error: activateError } = await db
    .from('prompt_versions')
    .update({ is_active: true })
    .eq('id', versionId)
    .select('id, prompt_key, version, is_active, is_default, label')
    .single();

  if (activateError) {
    console.error('[settings-admin] activate error:', activateError);
    return err('Failed to activate version', 500);
  }

  return json({ prompt: activatedRow });
}

// ---------------------------------------------------------------------------
// PATCH /settings-admin/prompt/restore-default — activate the is_default row
// ---------------------------------------------------------------------------

async function handleRestoreDefault(req: Request, userId: string): Promise<Response> {
  try { await requireAdmin(userId); } catch (r) { return r as Response; }

  let body: { prompt_key: string };
  try { body = await req.json(); } catch {
    return err('Invalid JSON body');
  }

  const { prompt_key } = body;

  if (!prompt_key)
    return err('prompt_key is required');

  if (!VALID_PROMPT_KEYS.has(prompt_key))
    return err(`Invalid prompt_key: "${prompt_key}"`);

  const db = getServiceClient();

  // Find the default row for this key.
  const { data: defaultRow, error: findError } = await db
    .from('prompt_versions')
    .select('id')
    .eq('prompt_key', prompt_key)
    .eq('is_default', true)
    .single();

  if (findError || !defaultRow)
    return err(`No default version found for prompt_key "${prompt_key}"`, 404);

  // Delegate to the activate path.
  // Deactivate all, then activate the default.
  const { error: deactivateError } = await db
    .from('prompt_versions')
    .update({ is_active: false })
    .eq('prompt_key', prompt_key);

  if (deactivateError) {
    console.error('[settings-admin] restore-default deactivate error:', deactivateError);
    return err('Failed to deactivate existing versions', 500);
  }

  const { data: restoredRow, error: restoreError } = await db
    .from('prompt_versions')
    .update({ is_active: true })
    .eq('id', defaultRow.id)
    .select('id, prompt_key, version, is_active, is_default, label')
    .single();

  if (restoreError) {
    console.error('[settings-admin] restore-default activate error:', restoreError);
    return err('Failed to restore default version', 500);
  }

  return json({ prompt: restoredRow });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return corsPreflightResponse();

  // Auth required for all routes.
  let userId: string;
  try {
    const user = await verifyAuth(req);
    userId = user.id;
  } catch (errResponse) {
    return errResponse as Response;
  }

  const url = new URL(req.url);
  // The Edge runtime may present the path with or without the
  // /functions/v1/ prefix. Strip everything up to and including the function
  // name so the sub-path is robust: '' | 'setting' | 'prompt' | 'prompt/:id/activate'
  const path = url.pathname.replace(/^.*\/settings-admin\/?/, '').replace(/^\//, '');

  // GET /settings-admin  → list settings + prompts
  if (req.method === 'GET' && path === '') {
    return handleGet(userId);
  }

  // PATCH /settings-admin/setting (single)
  if (req.method === 'PATCH' && path === 'setting') {
    return handlePatchSetting(req, userId);
  }

  // PATCH /settings-admin/settings (bulk, atomic)
  if (req.method === 'PATCH' && path === 'settings') {
    return handlePatchSettingsBulk(req, userId);
  }

  // POST /settings-admin/prompt
  if (req.method === 'POST' && path === 'prompt') {
    return handlePostPrompt(req, userId);
  }

  // PATCH /settings-admin/prompt/restore-default
  if (req.method === 'PATCH' && path === 'prompt/restore-default') {
    return handleRestoreDefault(req, userId);
  }

  // PATCH /settings-admin/prompt/:id/activate
  const activateMatch = path.match(/^prompt\/([^/]+)\/activate$/);
  if (req.method === 'PATCH' && activateMatch) {
    return handleActivatePrompt(req, userId, activateMatch[1]);
  }

  return json({ error: 'Not found' }, 404);
});
