import { Button } from '../ui/button';
import type { Epic } from '../../types/brd';

interface EpicProposalCardProps {
  epics: Epic[];
  onApproveAll: () => void;
  onEditInChat: () => void;
  disabled?: boolean;
}

export function EpicProposalCard({ epics, onApproveAll, onEditInChat, disabled }: EpicProposalCardProps) {
  return (
    <div
      role="region"
      aria-label="Proposed Epics"
      className="rounded-lg border border-border bg-secondary/50 p-4 space-y-3"
    >
      <h4 className="text-sm font-semibold text-foreground">Proposed Epics</h4>
      <ol className="space-y-3">
        {epics.map((epic, i) => (
          <li key={epic.id} className="flex gap-2 text-sm">
            <span className="text-muted-foreground font-medium shrink-0">{i + 1}.</span>
            <div>
              <p className="font-medium text-foreground">{epic.title}</p>
              {epic.description && (
                <p className="text-muted-foreground text-xs mt-0.5">{epic.description}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={onApproveAll} disabled={disabled}>
          Approve All Epics
        </Button>
        <Button size="sm" variant="outline" onClick={onEditInChat} disabled={disabled}>
          Edit in Chat
        </Button>
      </div>
    </div>
  );
}
