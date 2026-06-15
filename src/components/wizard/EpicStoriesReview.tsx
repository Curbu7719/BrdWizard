import { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { CheckCircle, Plus, X } from 'lucide-react';
import type { UserStory } from '../../types/brd';

interface EpicStoriesReviewProps {
  epicTitle: string;
  stories: UserStory[];
  onEditStory: (storyId: string, text: string) => void;
  onRemoveStory: (storyId: string) => void;
  onAddStory: () => void;
  onApproveAll: () => void;
  disabled?: boolean;
}

interface StoryRowProps {
  story: UserStory;
  onEdit: (text: string) => void;
  onRemove: () => void;
  disabled?: boolean;
  /** When true the row starts in edit mode (newly added story). */
  autoFocus?: boolean;
}

function StoryRow({ story, onEdit, onRemove, disabled, autoFocus }: StoryRowProps) {
  const [editing, setEditing] = useState(autoFocus ?? false);
  const [draft, setDraft] = useState(story.full_text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      // Place cursor at end
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [editing]);

  function handleSave() {
    if (!draft.trim()) return;
    onEdit(draft.trim());
    setEditing(false);
  }

  function handleCancel() {
    setDraft(story.full_text);
    setEditing(false);
  }

  return (
    <div className="rounded-md border border-border bg-background p-3 space-y-2">
      {editing ? (
        <>
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={7}
            className="text-sm resize-y font-mono"
            placeholder={'As a [persona], if I have permission, I should be able to [action] on the [channel] channel.\nAcceptance Criteria:\n- …'}
            onKeyDown={e => {
              if (e.key === 'Escape') handleCancel();
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSave();
            }}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={disabled || !draft.trim()}
            >
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <div className="flex items-start gap-2">
          <p
            className="flex-1 text-sm text-foreground leading-relaxed whitespace-pre-wrap cursor-pointer hover:text-accent-foreground"
            title="Click to edit"
            onClick={() => !disabled && setEditing(true)}
          >
            {story.full_text || <span className="text-muted-foreground italic">Empty — click to edit</span>}
          </p>
          <button
            type="button"
            aria-label="Remove story"
            className="shrink-0 mt-0.5 rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
            onClick={onRemove}
            disabled={disabled}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

export function EpicStoriesReview({
  epicTitle,
  stories,
  onEditStory,
  onRemoveStory,
  onAddStory,
  onApproveAll,
  disabled,
}: EpicStoriesReviewProps) {
  // Track which story id was just added so its row auto-focuses into edit mode.
  const [latestAddedId, setLatestAddedId] = useState<string | null>(null);
  const prevStoryIds = useRef<string[]>(stories.map(s => s.id));

  // Detect newly added story (id that wasn't in the previous render's set).
  useEffect(() => {
    const prev = new Set(prevStoryIds.current);
    const newStory = stories.find(s => !prev.has(s.id));
    if (newStory) setLatestAddedId(newStory.id);
    prevStoryIds.current = stories.map(s => s.id);
  }, [stories]);

  return (
    <div
      role="region"
      aria-label={`Proposed user stories for ${epicTitle}`}
      className="rounded-lg border border-border bg-secondary/50 px-4 py-4 space-y-4"
    >
      {/* Header */}
      <div className="space-y-0.5">
        <h4 className="text-sm font-semibold text-foreground">
          Proposed user stories for <span className="text-accent-foreground">{epicTitle}</span>
        </h4>
        <p className="text-xs text-muted-foreground">
          {stories.length === 0
            ? 'No stories yet — add one below.'
            : `${stories.length} ${stories.length === 1 ? 'story' : 'stories'} proposed. Edit, add, or remove before approving.`}
        </p>
      </div>

      {/* Story rows */}
      {stories.length > 0 && (
        <div className="space-y-2">
          {stories.map(story => (
            <StoryRow
              key={story.id}
              story={story}
              onEdit={text => onEditStory(story.id, text)}
              onRemove={() => onRemoveStory(story.id)}
              disabled={disabled}
              autoFocus={story.id === latestAddedId}
            />
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          onClick={onAddStory}
          disabled={disabled}
        >
          <Plus className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
          Add story
        </Button>

        <Button
          size="sm"
          onClick={onApproveAll}
          disabled={disabled || stories.length === 0}
          className="ml-auto"
        >
          <CheckCircle className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
          Approve all stories ({stories.length})
        </Button>
      </div>
    </div>
  );
}
