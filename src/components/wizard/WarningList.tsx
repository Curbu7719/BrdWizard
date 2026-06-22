import { AlertTriangle, Check, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import type { BrdWarning, WarningSource } from '../../types/brd';

const SOURCE_LABEL: Record<WarningSource, string> = {
  kvkk: 'KVKK',
  data_privacy: 'Data Privacy',
  regulation: 'Regulation',
  maturity: 'Maturity',
};

function severityClass(severity: string): string {
  const s = severity.toLowerCase();
  if (s === 'critical' || s === 'contradiction') return 'border-destructive/40 bg-destructive/5';
  if (s === 'info') return 'border-border bg-muted/40';
  return 'border-warning/40 bg-warning/5'; // warning, unclear, default
}

interface WarningListProps {
  warnings: BrdWarning[];
  onAcknowledge: (id: string) => void;
  /** Reject a finding (declines the recommendation; listed in the BRD's Rejected
   *  Findings section). When omitted, only the Acknowledge action is shown. */
  onReject?: (id: string) => void;
  className?: string;
}

export function WarningList({ warnings, onAcknowledge, onReject, className }: WarningListProps) {
  if (warnings.length === 0) return null;
  return (
    <div className={cn('space-y-2', className)}>
      {warnings.map(w => (
        <div key={w.id} className={cn('rounded-md border p-2.5 text-sm', severityClass(w.severity), w.status === 'acknowledged' && 'opacity-60')}>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
            <span className="inline-flex items-center rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              {SOURCE_LABEL[w.source] ?? w.source}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{w.severity}</span>
            {w.status === 'acknowledged' && (
              <span className="ml-auto inline-flex items-center gap-0.5 text-[10px] text-success">
                <Check className="h-3 w-3" aria-hidden="true" /> acknowledged
              </span>
            )}
            {w.status === 'rejected' && (
              <span className="ml-auto inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <X className="h-3 w-3" aria-hidden="true" /> rejected
              </span>
            )}
          </div>
          <p className="text-foreground leading-snug whitespace-pre-wrap">{w.message}</p>
          {w.recommendation && (
            <p className="mt-1 text-xs text-muted-foreground leading-snug whitespace-pre-wrap">
              <span className="font-medium">Recommendation: </span>{w.recommendation}
            </p>
          )}
          {w.status === 'open' && (
            <div className="mt-1.5 flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => onAcknowledge(w.id)}
                title="Accept the recommendation (added to the acceptance criteria)"
              >
                <Check className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                Acknowledge
              </Button>
              {onReject && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={() => onReject(w.id)}
                  title="Reject the recommendation (recorded in the BRD's Rejected Findings)"
                >
                  <X className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                  Reject
                </Button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
