-- ============================================================
-- 0005: Switch context thresholds from percentages to ABSOLUTE input tokens
-- ============================================================
-- With the context window auto-derived to ~1,000,000 (0004 + Models API), the
-- old percentage thresholds (warn 70% / checkpoint 85% / handoff 90%) never
-- fired in practice — a BRD session rarely exceeds ~10% of a 1M window.
--
-- Replace them with fixed input-token thresholds that fire regardless of window
-- size: warn 300K, checkpoint 500K, handoff 800K (≈200K headroom before 1M).
-- The old keys are removed; the settings loader ignores unknown keys anyway.

delete from public.app_settings
 where key in (
   'context.threshold_warn_pct',
   'context.threshold_checkpoint_pct',
   'context.threshold_handoff_pct'
 );

insert into public.app_settings (key, value, description) values
  ('context.threshold_warn_tokens',       '300000', 'Input-token count at which to warn the user'),
  ('context.threshold_checkpoint_tokens', '500000', 'Input-token count at which to auto-checkpoint the active section'),
  ('context.threshold_handoff_tokens',    '800000', 'Input-token count at which to generate a session handoff package')
on conflict (key) do update set value = excluded.value, description = excluded.description;
