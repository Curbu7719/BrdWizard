import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { RECOMMENDED_SCORE, type BrdScore } from '../../lib/brdScore';

interface ScoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  score: BrdScore | null;
  generating: boolean;
  onGenerateAnyway: () => void;
}

function scoreColor(score: number): string {
  if (score >= RECOMMENDED_SCORE) return 'text-success';
  if (score >= 50) return 'text-warning';
  return 'text-destructive';
}

function barColor(earned: number, max: number): string {
  const pct = max > 0 ? earned / max : 0;
  if (pct >= 0.8) return 'bg-success';
  if (pct >= 0.5) return 'bg-warning';
  return 'bg-destructive';
}

export function ScoreDialog({ open, onOpenChange, score, generating, onGenerateAnyway }: ScoreDialogProps) {
  if (!score) return null;
  const meets = score.score >= RECOMMENDED_SCORE;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>BRD Readiness Score</DialogTitle>
          <DialogDescription>
            {meets
              ? `Score is ${score.score}/100. A score of ${RECOMMENDED_SCORE} or above is recommended — you're good to go. Generate the BRD?`
              : `A score of ${RECOMMENDED_SCORE} or above is recommended before generating. Close the open items to raise it, or generate anyway.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-4 py-1">
          <div className={cn('text-5xl font-bold tabular-nums', scoreColor(score.score))}>
            {score.score}
          </div>
          <div className="text-sm text-muted-foreground">
            <div>out of 100</div>
            <div>Recommended: {RECOMMENDED_SCORE}+</div>
          </div>
        </div>

        <div className="space-y-2.5">
          {score.breakdown.map(item => (
            <div key={item.label} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{item.label}</span>
                <span className="tabular-nums text-muted-foreground">{item.earned}/{item.max}</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('h-full rounded-full', barColor(item.earned, item.max))}
                  style={{ width: `${item.max > 0 ? (item.earned / item.max) * 100 : 0}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generating}>
            {meets ? 'Cancel' : 'Keep editing'}
          </Button>
          <Button onClick={onGenerateAnyway} loading={generating} disabled={generating}>
            {meets ? 'Generate BRD' : 'Generate anyway'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
