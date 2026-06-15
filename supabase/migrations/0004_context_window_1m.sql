-- ============================================================
-- 0004: Raise context window to the model's native maximum (1M)
-- ============================================================
-- claude-sonnet-4-6 (the BRD agent model) natively supports a 1,000,000-token
-- context window. `context.window_tokens` is the DENOMINATOR the platform uses
-- to compute context_token_pct = input_tokens / window_tokens, which drives the
-- warn / checkpoint / handoff thresholds (ADR-0001). It is NOT an API cap.
-- The original seed (0002) used 200,000, causing the thresholds to fire far too
-- early (~140K/170K/180K). Bump the live row to the real capacity.
--
-- NOTE: the effective window is now AUTO-DERIVED at runtime from the Models API
-- (max_input_tokens); this row is only a fallback when that lookup is
-- unavailable (no API key / network error). See _shared/settings.ts.

update public.app_settings
   set value = '1000000'
 where key = 'context.window_tokens';
