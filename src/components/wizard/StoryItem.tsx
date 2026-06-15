import { useState, useRef, useEffect } from 'react';
import { CheckCircle, PenLine, Pencil, Save, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { WarningList } from './WarningList';
import type { UserStory, BrdWarning } from '../../types/brd';

interface StoryItemProps {
  story: UserStory;
  className?: string;
  /** When provided, the story becomes editable in place (right panel). */
  onEdit?: (storyId: string, text: string) => void | Promise<void>;
  /** Review findings attached to this story. */
  warnings?: BrdWarning[];
  onAcknowledgeWarning?: (id: string) => void;
}

export function StoryItem({ story, className, onEdit, warnings = [], onAcknowledgeWarning }: StoryItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(story.full_text);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [editing]);

  async function handleSave() {
    if (!onEdit || !draft.trim()) return;
    setSaving(true);
    await onEdit(story.id, draft.trim());
    setSaving(false);
    setEditing(false);
  }

  function handleCancel() {
    setDraft(story.full_text);
    setEditing(false);
  }

  if (editing) {
    return (
      <li className={cn('py-1.5 space-y-2', className)}>
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={7}
          disabled={saving}
          className="text-sm resize-y font-mono"
          aria-label="Edit story"
          onKeyDown={e => {
            if (e.key === 'Escape') handleCancel();
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void handleSave();
          }}
        />
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void handleSave()} disabled={saving || !draft.trim()}>
            <Save className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="sm" variant="outline" onClick={handleCancel} disabled={saving}>
            <X className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className={cn('py-1.5 text-sm', className)}>
      <div className="group flex gap-2 items-start">
        <span className="shrink-0 mt-0.5">
          {story.is_approved ? (
            <CheckCircle className="h-4 w-4 text-success" aria-label="Approved" />
          ) : (
            <span className="inline-block h-4 w-4 rounded-full border-2 border-muted-foreground" aria-label="Pending approval" />
          )}
        </span>
        <span className={cn('flex-1 leading-snug whitespace-pre-wrap', !story.is_approved && 'text-muted-foreground')}>
          {story.full_text}
        </span>
        {story.is_edited && (
          <span className="shrink-0 inline-flex items-center gap-0.5 text-xs text-warning" title="Edited by user">
            <PenLine className="h-3 w-3" aria-hidden="true" />
            edited
          </span>
        )}
        {onEdit && (
          <button
            type="button"
            aria-label="Edit story"
            className="shrink-0 mt-0.5 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-accent hover:bg-accent/10 transition-all"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      {warnings.length > 0 && onAcknowledgeWarning && (
        <WarningList warnings={warnings} onAcknowledge={onAcknowledgeWarning} className="mt-1.5 ml-6" />
      )}
    </li>
  );
}
