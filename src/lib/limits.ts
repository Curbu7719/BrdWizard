/*
 * Input length limits (Phase-1: hardcoded sensible defaults).
 *
 * Background & Objective are injected as full text into EVERY epic/story
 * generation turn, so an upper bound directly controls per-turn token cost;
 * a lower bound ensures there's enough substance for good epics.
 *
 * Phase-2 TODO: make these admin-parametric via app_settings (group:
 * "Classification & Files / Policy") and read them through settings-admin,
 * mirroring docs/ADMIN-CONFIG.md. Until then, these constants are the single
 * source of truth — import from here, don't re-hardcode.
 */
export const INPUT_LIMITS = {
  background: { min: 40, max: 3000 },
  objective: { min: 40, max: 3000 },
  chatMessage: { min: 1, max: 4000 },
} as const;

/**
 * Returns an error string if `value` is out of [min, max] for a labelled field,
 * or null if valid. Used by the setup form.
 */
export function lengthError(
  value: string,
  label: string,
  bounds: { min: number; max: number }
): string | null {
  const len = value.trim().length;
  if (len === 0) return `Please enter the ${label.toLowerCase()}.`;
  if (len < bounds.min) return `${label} is too short (minimum ${bounds.min} characters).`;
  if (len > bounds.max) return `${label} is too long (maximum ${bounds.max} characters).`;
  return null;
}
