import { CheckCircle, Circle, Clock } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { BrdStatus, SectionStatus } from '../../types/brd';

interface BrdStatusBadgeProps {
  status: BrdStatus;
  className?: string;
}

export function BrdStatusBadge({ status, className }: BrdStatusBadgeProps) {
  if (status === 'complete') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-sm text-success font-medium', className)}>
        <CheckCircle className="h-4 w-4" aria-hidden="true" />
        Complete
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm text-warning font-medium', className)}>
      <Circle className="h-3.5 w-3.5 fill-warning text-warning" aria-hidden="true" />
      Draft
    </span>
  );
}

interface SectionStatusBadgeProps {
  status: SectionStatus;
  className?: string;
}

export function SectionStatusBadge({ status, className }: SectionStatusBadgeProps) {
  const map: Record<SectionStatus, { label: string; icon: React.ReactNode; cls: string }> = {
    pending: {
      label: 'Pending',
      icon: <Circle className="h-3.5 w-3.5" aria-hidden="true" />,
      cls: 'text-muted-foreground',
    },
    in_progress: {
      label: 'In progress',
      icon: <Clock className="h-3.5 w-3.5" aria-hidden="true" />,
      cls: 'text-accent',
    },
    approved: {
      label: 'Approved',
      icon: <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />,
      cls: 'text-success',
    },
  };
  const { label, icon, cls } = map[status];
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', cls, className)}>
      {icon}
      {label}
    </span>
  );
}
