import { CheckCircle, PenLine } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { UserStory } from '../../types/brd';

interface StoryItemProps {
  story: UserStory;
  className?: string;
}

export function StoryItem({ story, className }: StoryItemProps) {
  return (
    <li className={cn('flex gap-2 items-start py-1.5 text-sm', className)}>
      <span className="shrink-0 mt-0.5">
        {story.is_approved ? (
          <CheckCircle className="h-4 w-4 text-success" aria-label="Approved" />
        ) : (
          <span className="inline-block h-4 w-4 rounded-full border-2 border-muted-foreground" aria-label="Pending approval" />
        )}
      </span>
      <span className={cn('leading-snug', !story.is_approved && 'text-muted-foreground')}>
        {story.full_text}
      </span>
      {story.is_edited && (
        <span className="shrink-0 inline-flex items-center gap-0.5 text-xs text-warning" title="Edited by user">
          <PenLine className="h-3 w-3" aria-hidden="true" />
          edited
        </span>
      )}
    </li>
  );
}
