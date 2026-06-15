import { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import type { UserStory } from '../../types/brd';

interface StoryApprovalCardProps {
  story: UserStory;
  epicTitle: string;
  onApprove: (storyId: string) => void;
  onSaveEdit: (storyId: string, text: string) => void;
  disabled?: boolean;
}

export function StoryApprovalCard({
  story,
  epicTitle,
  onApprove,
  onSaveEdit,
  disabled,
}: StoryApprovalCardProps) {
  const [rewriting, setRewriting] = useState(false);
  const [editText, setEditText] = useState(story.full_text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const approveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (rewriting && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [rewriting]);

  function handleApprove() {
    onApprove(story.id);
    // Focus will be managed by parent scrolling
  }

  function handleSave() {
    onSaveEdit(story.id, editText);
    setRewriting(false);
  }

  function handleCancel() {
    setEditText(story.full_text);
    setRewriting(false);
    approveRef.current?.focus();
  }

  return (
    <div
      role="region"
      aria-label={`User story for ${epicTitle}`}
      className="rounded-lg border border-border bg-secondary/50 p-4 space-y-3"
    >
      <h4 className="text-sm font-semibold text-foreground">User Story</h4>

      {!rewriting ? (
        <>
          <p className="text-sm text-foreground leading-relaxed">{story.full_text}</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              ref={approveRef}
              onClick={handleApprove}
              disabled={disabled}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRewriting(true)}
              disabled={disabled}
            >
              Rewrite…
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1">
            <label htmlFor={`story-edit-${story.id}`} className="text-xs text-muted-foreground font-medium">
              Edit story text:
            </label>
            <Textarea
              id={`story-edit-${story.id}`}
              ref={textareaRef}
              value={editText}
              onChange={e => setEditText(e.target.value)}
              rows={4}
              className="text-sm"
              onKeyDown={e => {
                if (e.key === 'Escape') handleCancel();
              }}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={disabled || !editText.trim()}>
              Save My Version
            </Button>
            <Button size="sm" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
