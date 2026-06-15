import { ShieldCheck, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/button';
import { WarningList } from './WarningList';
import type { BrdWarning, ReviewStage } from '../../types/brd';

interface ReviewPanelProps {
  stage: ReviewStage;
  busy: boolean;
  canSubmit: boolean;
  openCount: number;
  totalCount: number;
  /** BRD-level findings (target_type === 'brd') not tied to a section or story. */
  generalWarnings: BrdWarning[];
  onSubmit: () => void;
  onAcknowledge: (id: string) => void;
}

export function ReviewPanel({
  stage, busy, canSubmit, openCount, totalCount, generalWarnings, onSubmit, onAcknowledge,
}: ReviewPanelProps) {
  const running = stage === 'compliance_running' || stage === 'maturity_running' || stage === 'compliance_done';

  return (
    <div className="rounded-lg border border-border bg-background p-3 space-y-3 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-accent" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-foreground">Compliance & Maturity Review</h3>
      </div>

      {stage === 'none' && (
        <>
          <p className="text-xs text-muted-foreground">
            Submit the finished BRD for KVKK, Data Privacy and Regulation review (Batch API),
            followed by a maturity check for contradictions and clarity. Findings appear on the
            relevant sections and user stories.
          </p>
          <Button size="sm" onClick={onSubmit} disabled={!canSubmit || busy} loading={busy}>
            Submit for review
          </Button>
          {!canSubmit && (
            <p className="text-xs text-muted-foreground">Approve all sections first.</p>
          )}
        </>
      )}

      {running && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
          <span>
            {stage === 'compliance_running' && 'Compliance review in progress (KVKK, Data Privacy, Regulation)…'}
            {(stage === 'compliance_done' || stage === 'maturity_running') && 'Running maturity check…'}
          </span>
        </div>
      )}

      {stage === 'maturity_done' && (
        <>
          {totalCount === 0 ? (
            <div className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              <span>Review complete — no findings.</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
              <span>
                Review complete — <strong>{openCount}</strong> open of {totalCount} findings.
                Address them on the relevant items, or acknowledge.
              </span>
            </div>
          )}

          {generalWarnings.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">General findings</p>
              <WarningList warnings={generalWarnings} onAcknowledge={onAcknowledge} />
            </div>
          )}

          <Button size="sm" variant="outline" onClick={onSubmit} disabled={busy} loading={busy}>
            Re-run review
          </Button>
        </>
      )}
    </div>
  );
}
