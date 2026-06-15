import { CheckCircle } from 'lucide-react';
import { StoryItem } from './StoryItem';
import type { Epic, UserStory } from '../../types/brd';

interface EpicBlockProps {
  epic: Epic;
  stories: UserStory[];
}

export function EpicBlock({ epic, stories }: EpicBlockProps) {
  const allApproved = stories.length > 0 && stories.every(s => s.is_approved);

  return (
    <div className="rounded-lg border border-border bg-background p-3 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-sm font-semibold text-foreground flex-1">
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
          {stories.map(story => (
            <StoryItem key={story.id} story={story} />
          ))}
        </ul>
      )}
    </div>
  );
}
