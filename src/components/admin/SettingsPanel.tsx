import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Spinner } from '../shared/Spinner';
import { toast } from '../../hooks/useToast';
import { callEdgeFunctionGet, callEdgeFunctionPatch } from '../../lib/sse';

// ---------------------------------------------------------------------------
// Types mirroring the settings-admin GET response (§2 of ADMIN-CONFIG.md)
// ---------------------------------------------------------------------------

interface ContextSettings {
  'context.window_tokens': number;
  'context.threshold_warn_tokens': number;
  'context.threshold_checkpoint_tokens': number;
  'context.threshold_handoff_tokens': number;
  'context.max_turns_per_section': number;
}

// The settings-admin GET returns `settings` as an ARRAY of { key, value } rows.
type ContextSettingsResponse = {
  settings: Array<{ key: string; value: unknown }>;
};

// ---------------------------------------------------------------------------
// Field descriptors
// ---------------------------------------------------------------------------

interface FieldDef {
  key: keyof ContextSettings;
  label: string;
  help: string;
  min: number;
  max: number;
  defaultValue: number;
}

const FIELDS: FieldDef[] = [
  {
    key: 'context.window_tokens',
    label: 'Context Window (tokens) — fallback',
    help: 'Auto-detected from the model API (max_input_tokens). This value is only used as a fallback if that lookup is unavailable. Range: 50,000 – 1,000,000.',
    min: 50000,
    max: 1000000,
    defaultValue: 1000000,
  },
  {
    key: 'context.threshold_warn_tokens',
    label: 'Warn Threshold (tokens)',
    help: 'Input-token count at which to warn the user. Range: 10,000 – 1,000,000.',
    min: 10000,
    max: 1000000,
    defaultValue: 300000,
  },
  {
    key: 'context.threshold_checkpoint_tokens',
    label: 'Checkpoint Threshold (tokens)',
    help: 'Input-token count at which to auto-checkpoint the active section. Range: 10,000 – 1,000,000.',
    min: 10000,
    max: 1000000,
    defaultValue: 500000,
  },
  {
    key: 'context.threshold_handoff_tokens',
    label: 'Handoff Threshold (tokens)',
    help: 'Input-token count at which to generate a session handoff package. Range: 10,000 – 1,000,000.',
    min: 10000,
    max: 1000000,
    defaultValue: 800000,
  },
  {
    key: 'context.max_turns_per_section',
    label: 'Max Turns per Section',
    help: 'Maximum conversation turns allowed per section before a forced draft. Range: 5 – 50.',
    min: 5,
    max: 50,
    defaultValue: 15,
  },
];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateField(field: FieldDef, value: number): string | null {
  if (!Number.isInteger(value)) return 'Must be a whole number.';
  if (value < field.min || value > field.max)
    return `Must be between ${field.min.toLocaleString()} and ${field.max.toLocaleString()}.`;
  return null;
}

function validateThresholdOrder(
  warn: number,
  checkpoint: number,
  handoff: number
): string | null {
  if (!(warn < checkpoint && checkpoint < handoff))
    return `Thresholds must be strictly increasing: Warn (${warn}) < Checkpoint (${checkpoint}) < Handoff (${handoff}).`;
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Raw string values for inputs (users type strings)
  const [values, setValues] = useState<Record<string, string>>({
    'context.window_tokens': '1000000',
    'context.threshold_warn_tokens': '300000',
    'context.threshold_checkpoint_tokens': '500000',
    'context.threshold_handoff_tokens': '800000',
    'context.max_turns_per_section': '15',
  });

  // Values as loaded from server (to detect "unchanged")
  const [serverValues, setServerValues] = useState<Record<string, number>>({});

  // Per-field validation errors
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Cross-field threshold ordering error
  const [orderError, setOrderError] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    const { data, error } = await callEdgeFunctionGet<ContextSettingsResponse>('settings-admin');
    setLoading(false);

    if (error) {
      toast({
        title: 'Failed to load settings',
        description: error,
        variant: 'destructive',
      });
      return;
    }

    if (!data?.settings) return;

    // GET returns an array of { key, value }; index it by key.
    const byKey: Record<string, unknown> = {};
    for (const row of data.settings) byKey[row.key] = row.value;

    const next: Record<string, string> = { ...values };
    const nextServer: Record<string, number> = {};

    for (const field of FIELDS) {
      const raw = byKey[field.key];
      if (raw !== undefined && raw !== null) {
        const num = Number(raw);
        next[field.key] = String(num);
        nextServer[field.key] = num;
      } else {
        nextServer[field.key] = field.defaultValue;
      }
    }

    setValues(next);
    setServerValues(nextServer);
  }

  function handleChange(key: string, raw: string) {
    setValues(prev => ({ ...prev, [key]: raw }));

    // Validate this field
    const field = FIELDS.find(f => f.key === key);
    if (!field) return;
    const num = Number(raw);
    const err = validateField(field, num);
    setFieldErrors(prev => ({ ...prev, [key]: err ?? '' }));

    // Re-run threshold order check with the updated value
    const next = { ...values, [key]: raw };
    const warn = Number(next['context.threshold_warn_tokens']);
    const ckpt = Number(next['context.threshold_checkpoint_tokens']);
    const hand = Number(next['context.threshold_handoff_tokens']);
    if (
      Number.isInteger(warn) &&
      Number.isInteger(ckpt) &&
      Number.isInteger(hand)
    ) {
      setOrderError(validateThresholdOrder(warn, ckpt, hand));
    } else {
      setOrderError(null);
    }
  }

  function computeNumericValues(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const field of FIELDS) {
      out[field.key] = Number(values[field.key]);
    }
    return out;
  }

  function hasErrors(): boolean {
    for (const field of FIELDS) {
      if (fieldErrors[field.key]) return true;
    }
    if (orderError) return true;
    return false;
  }

  function isUnchanged(): boolean {
    const numeric = computeNumericValues();
    return FIELDS.every(f => numeric[f.key] === serverValues[f.key]);
  }

  async function handleSave() {
    // Run full validation before saving
    const numeric = computeNumericValues();
    const errors: Record<string, string> = {};
    let anyError = false;

    for (const field of FIELDS) {
      const err = validateField(field, numeric[field.key]);
      if (err) {
        errors[field.key] = err;
        anyError = true;
      }
    }
    setFieldErrors(errors);

    const orderErr = validateThresholdOrder(
      numeric['context.threshold_warn_tokens'],
      numeric['context.threshold_checkpoint_tokens'],
      numeric['context.threshold_handoff_tokens']
    );
    setOrderError(orderErr);
    if (orderErr) anyError = true;

    if (anyError) return;

    setSaving(true);

    // Send only changed keys — in ONE atomic request (no partial saves).
    const changed: Array<{ key: string; value: number }> = [];
    for (const field of FIELDS) {
      if (numeric[field.key] !== serverValues[field.key]) {
        changed.push({ key: field.key, value: numeric[field.key] });
      }
    }

    const { error } = await callEdgeFunctionPatch<unknown>('settings-admin/settings', {
      updates: changed,
    });

    setSaving(false);

    if (error) {
      toast({
        title: 'Save failed',
        description: error,
        variant: 'destructive',
      });
    } else {
      // Refresh server values to reflect saved state
      const next: Record<string, number> = {};
      for (const field of FIELDS) {
        next[field.key] = numeric[field.key];
      }
      setServerValues(next);
      toast({ title: 'Settings saved', description: 'Context & turn settings updated.' });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-foreground">Context & Turns</h2>
      </div>

      <div className="rounded-lg border border-border bg-background p-6 space-y-6">
        {FIELDS.map(field => {
          const err = fieldErrors[field.key];
          const isThreshold = [
            'context.threshold_warn_tokens',
            'context.threshold_checkpoint_tokens',
            'context.threshold_handoff_tokens',
          ].includes(field.key);

          return (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={field.key}>{field.label}</Label>
              <Input
                id={field.key}
                type="number"
                value={values[field.key]}
                onChange={e => handleChange(field.key, e.target.value)}
                min={field.min}
                max={field.max}
                className={['w-48', err ? 'border-destructive focus-visible:ring-destructive' : ''].join(' ')}
                aria-describedby={`${field.key}-help${err ? ` ${field.key}-error` : ''}`}
              />
              <p id={`${field.key}-help`} className="text-xs text-muted-foreground">
                {field.help}
              </p>
              {err && (
                <p id={`${field.key}-error`} role="alert" className="text-xs text-destructive">
                  {err}
                </p>
              )}
              {/* Show order error under the last threshold field */}
              {isThreshold && field.key === 'context.threshold_handoff_tokens' && orderError && (
                <p role="alert" className="text-xs text-destructive">
                  {orderError}
                </p>
              )}
            </div>
          );
        })}

        <div className="pt-2">
          <Button
            onClick={() => void handleSave()}
            loading={saving}
            disabled={saving || hasErrors() || isUnchanged()}
          >
            Save Context Settings
          </Button>
        </div>
      </div>
    </div>
  );
}
