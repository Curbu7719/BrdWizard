import { useState, useEffect } from 'react';
import { Textarea } from '../ui/textarea';
import { Button } from '../ui/button';

interface BrdInputCardProps {
  label: string;
  placeholder: string;
  value: string;
  onSave: (text: string) => void | Promise<void>;
}

/**
 * A small editable free-text card for the right panel (Expected Value, Notes).
 * Saves on blur and via an explicit Save button; while the textarea is focused,
 * upstream refetches do NOT clobber the in-progress draft.
 */
export function BrdInputCard({ label, placeholder, value, onSave }: BrdInputCardProps) {
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [focused, setFocused] = useState(false);

  // Sync from upstream only while the user isn't actively editing.
  useEffect(() => {
    if (!focused) setDraft(value ?? '');
  }, [value, focused]);

  const dirty = draft.trim() !== (value ?? '').trim();

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    await onSave(draft.trim());
    setSaving(false);
  }

  return (
    <div className="rounded-lg border border-border bg-background p-3 space-y-2 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
      </div>
      <Textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); void save(); }}
        rows={3}
        placeholder={placeholder}
        className="text-sm resize-y"
      />
      {dirty && !saving && (
        <Button size="sm" onMouseDown={e => e.preventDefault()} onClick={() => void save()}>
          Save
        </Button>
      )}
    </div>
  );
}
