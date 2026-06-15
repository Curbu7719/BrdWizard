import { useState } from 'react';
import { ArrowLeft, ChevronDown, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Spinner } from '../shared/Spinner';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../ui/dropdown-menu';
import { useAuth } from '../../hooks/useAuth';
import type { BrdDocument, ReviewStage } from '../../types/brd';

interface WorkspaceHeaderProps {
  brd: BrdDocument;
  onTitleChange: (title: string) => void;
  /** Review pipeline. */
  reviewStage: ReviewStage;
  canSubmitReview: boolean;
  reviewBusy: boolean;
  onSubmitReview: () => void;
}

export function WorkspaceHeader({
  brd,
  onTitleChange,
  reviewStage,
  canSubmitReview,
  reviewBusy,
  onSubmitReview,
}: WorkspaceHeaderProps) {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(brd.title);

  const displayName = user?.email ?? 'User';
  const initials = displayName.slice(0, 2).toUpperCase();

  function commitTitle() {
    setEditing(false);
    if (draftTitle.trim() && draftTitle !== brd.title) {
      onTitleChange(draftTitle.trim());
    } else {
      setDraftTitle(brd.title);
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-20 h-14 border-b border-border bg-background flex items-center px-4 gap-3">
      {/* Back */}
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Dashboard
      </button>

      <span className="text-border mx-1">|</span>

      {/* Editable title */}
      {editing ? (
        <Input
          className="text-lg font-semibold h-8 max-w-xs"
          value={draftTitle}
          onChange={e => setDraftTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={e => {
            if (e.key === 'Enter') commitTitle();
            if (e.key === 'Escape') { setDraftTitle(brd.title); setEditing(false); }
          }}
          autoFocus
        />
      ) : (
        <button
          onClick={() => { setDraftTitle(brd.title); setEditing(true); }}
          className="text-lg font-semibold text-foreground hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded max-w-sm truncate"
          title="Click to rename"
        >
          {brd.title}
        </button>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* Submit for review */}
        {(() => {
          const running =
            reviewStage === 'compliance_running' ||
            reviewStage === 'compliance_done' ||
            reviewStage === 'maturity_running';
          if (running) {
            return (
              <Button size="sm" variant="outline" disabled>
                <Spinner size="sm" />
                Reviewing…
              </Button>
            );
          }
          const label = reviewStage === 'maturity_done' ? 'Re-run Review' : 'Submit for Review';
          return (
            <Button
              size="sm"
              variant="outline"
              onClick={onSubmitReview}
              disabled={!canSubmitReview || reviewBusy}
              loading={reviewBusy}
              title={!canSubmitReview ? 'Approve all sections first' : undefined}
            >
              {label}
            </Button>
          );
        })()}

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-foreground text-xs font-semibold">
                {initials}
              </span>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" aria-hidden="true" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
