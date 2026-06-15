import { FileText, Plus } from 'lucide-react';
import { BrdCard } from './BrdCard';
import { SkeletonCard } from '../shared/SkeletonCard';
import { Button } from '../ui/button';
import type { BrdDocument } from '../../types/brd';

interface BrdListProps {
  brds: BrdDocument[];
  loading: boolean;
  currentUserId?: string;
  onNew?: () => void;
  onDeleted?: () => void;
  onUpdated?: () => void;
  showNewButton?: boolean;
}

export function BrdList({
  brds,
  loading,
  currentUserId,
  onNew,
  onDeleted,
  onUpdated,
  showNewButton = false,
}: BrdListProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (brds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-lg">
        <FileText className="h-10 w-10 text-muted-foreground/40 mb-3" aria-hidden="true" />
        <p className="text-base font-medium text-foreground">No BRDs yet.</p>
        <p className="text-sm text-muted-foreground mb-4">Start by creating a new one.</p>
        {showNewButton && onNew && (
          <Button onClick={onNew}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New BRD
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {brds.map(brd => (
        <BrdCard
          key={brd.id}
          brd={brd}
          isOwner={brd.owner_id === currentUserId}
          onDeleted={onDeleted}
          onUpdated={onUpdated}
        />
      ))}
    </div>
  );
}
