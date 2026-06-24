import { CheckCircle } from 'lucide-react';
import { StoryItem } from './StoryItem';
import type { Epic, UserStory, BrdWarning } from '../../types/brd';

interface EpicBlockProps {
  epic: Epic;
  stories: UserStory[];
  /** Epic document number (e.g. "3.1"); shown before the title when provided. */
  epicNumber?: string;
  /** story id → document number (e.g. "3.1.2"), shown on each story. */
  storyNumbers?: Map<string, string>;
  /** When provided, each story can be edited in place. */
  onEditStory?: (storyId: string, text: string) => void | Promise<void>;
  /** Review findings across this BRD (filtered per story below). */
  warnings?: BrdWarning[];
  onAcknowledgeWarning?: (id: string) => void;
  onRejectWarning?: (id: string) => void;
}

export function EpicBlock({ epic, stories, epicNumber, storyNumbers, onEditStory, warnings = [], onAcknowledgeWarning, onRejectWarning }: EpicBlockProps) {
  const allApproved = stories.length > 0 && stories.every(s => s.is_approved);

  return (
    <div className="rounded-lg border border-border bg-background p-3 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-sm font-semibold text-foreground flex-1">
          {epicNumber && <span className="text-muted-foreground tabular-nums mr-1.5">{epicNumber}</span>}
          {epic.title}
        </h4>
        {allApproved && <CheckCircle className="h-4 w-4 text-success shrink-0" aria-label="All stories approved" />}
        {!epic.is_approved && <span className="text-xs text-muted-foreground">(awaiting approval)</span>}
        {epic.is_approved && !allApproved && stories.length === 0 && (
          <span className="text-xs text-accent">(in progress)</span>
        )}
      </div>

      {stories.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No stories yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {stories.map((story, i) => (
            <StoryItem
              key={story.id}
              story={story}
              index={i + 1}
              label={storyNumbers?.get(story.id)}
              onEdit={onEditStory}
              warnings={warnings.filter(w => w.target_story_id === story.id)}
              onAcknowledgeWarning={onAcknowledgeWarning}
              onRejectWarning={onRejectWarning}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
