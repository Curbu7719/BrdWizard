import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import { ContextHintBanner } from './ContextHintBanner';
import { ClassificationForm } from './ClassificationForm';
import { EpicProposalCard } from './EpicProposalCard';
import { EpicStoriesReview } from './EpicStoriesReview';
import { Button } from '../ui/button';
import { CheckCircle } from 'lucide-react';
import type { ChatMessage, ContextWarningLevel } from '../../hooks/useChat';
import type { Epic, UserStory } from '../../types/brd';
import type { ClassificationData } from './ClassificationForm';

interface MessageListProps {
  messages: ChatMessage[];
  streaming: boolean;
  contextLevel: ContextWarningLevel;
  contextPct?: number;
  onRetry?: () => void;
  onFinishSection?: () => void;

  // ── Classification ────────────────────────────────────────────────────────
  showClassification?: boolean;
  classificationInitialTitle?: string;
  classificationDisabled?: boolean;
  onClassificationSubmit?: (data: ClassificationData) => void;

  // ── Section approval ──────────────────────────────────────────────────────
  pendingApprovalSectionKey?: string | null;
  onSectionApprove?: (sectionKey: string) => void;

  // ── Epic proposal ─────────────────────────────────────────────────────────
  showEpicProposal?: boolean;
  proposedEpics?: Epic[];
  onApproveAllEpics?: () => void;
  onEditEpicsInChat?: () => void;

  // ── Story approval (batch) ────────────────────────────────────────────────
  pendingStories?: UserStory[];
  pendingEpicTitle?: string;
  onEditStory?: (storyId: string, text: string) => void;
  onRemoveStory?: (storyId: string) => void;
  onAddStory?: () => void;
  onApproveAllStories?: () => void;
}

export function MessageList({
  messages,
  streaming,
  contextLevel,
  contextPct,
  onRetry,
  onFinishSection,
  showClassification,
  classificationInitialTitle,
  classificationDisabled,
  onClassificationSubmit,
  pendingApprovalSectionKey,
  onSectionApprove,
  showEpicProposal,
  proposedEpics,
  onApproveAllEpics,
  onEditEpicsInChat,
  pendingStories,
  pendingEpicTitle,
  onEditStory,
  onRemoveStory,
  onAddStory,
  onApproveAllStories,
}: MessageListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  // Detect manual scroll
  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    userScrolledRef.current = !atBottom;
  }

  // Auto-scroll to bottom when streaming or new content appears unless user scrolled up.
  // Scroll the LIST CONTAINER only (not scrollIntoView) — scrollIntoView can scroll the
  // whole window/page, which made the page jump on every new message.
  useEffect(() => {
    if (!userScrolledRef.current) {
      const el = listRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, streaming, showClassification, showEpicProposal, pendingStories?.length]);

  // Show "Thinking..." while streaming with empty assistant message
  const showThinking =
    streaming &&
    messages.length > 0 &&
    messages[messages.length - 1].content === '' &&
    messages[messages.length - 1].role === 'assistant';

  // Label a section key for display
  function sectionLabel(key: string): string {
    const labels: Record<string, string> = {
      background: 'Background',
      objective: 'Objective',
      epics_overview: 'Epics Overview',
    };
    return labels[key] ?? key;
  }

  return (
    <div
      ref={listRef}
      role="log"
      aria-live="polite"
      aria-atomic="false"
      aria-label="Chat messages"
      className="flex-1 overflow-y-auto px-6 py-5 space-y-5"
      onScroll={handleScroll}
    >
      {messages.length === 0 && !streaming && !showClassification && (
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
          <p>Start the conversation to begin your BRD.</p>
        </div>
      )}

      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} onRetry={msg.status === 'error' ? onRetry : undefined} />
      ))}

      {/* ── Classification form — shown as a pseudo-AI message on first entry ── */}
      {showClassification && (
        <div className="flex gap-3 items-start max-w-[85%]">
          <div
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground text-xs font-bold"
          >
            AI
          </div>
          <div className="flex-1 space-y-3">
            <div className="rounded-lg border bg-card border-l-4 border-l-accent border-border px-4 py-3 text-base text-foreground">
              <p>Before we begin, set a few optional parameters. You can skip any of these.</p>
            </div>
            <ClassificationForm
              initialTitle={classificationInitialTitle}
              onSubmit={onClassificationSubmit ?? (() => undefined)}
              disabled={classificationDisabled}
            />
          </div>
        </div>
      )}

      {/* ── Section approval button — shown after section_ready SSE event ── */}
      {pendingApprovalSectionKey && onSectionApprove && (
        <div className="flex gap-3 items-start max-w-[85%]">
          <div
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground text-xs font-bold"
          >
            AI
          </div>
          <div
            role="region"
            aria-label={`Approve ${sectionLabel(pendingApprovalSectionKey)} section`}
            className="rounded-lg border border-border bg-secondary/50 px-4 py-3 space-y-3 flex-1"
          >
            <p className="text-sm text-foreground">
              The <strong>{sectionLabel(pendingApprovalSectionKey)}</strong> section draft is ready for your review.
              Click Approve to continue, or keep chatting to refine it.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => onSectionApprove(pendingApprovalSectionKey)}
              >
                <CheckCircle className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                Approve Section
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Epic proposal card — shown after epics_proposed SSE event ── */}
      {showEpicProposal && proposedEpics && proposedEpics.length > 0 && (
        <div className="flex gap-3 items-start max-w-[85%]">
          <div
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground text-xs font-bold"
          >
            AI
          </div>
          <div className="flex-1">
            <EpicProposalCard
              epics={proposedEpics}
              onApproveAll={onApproveAllEpics ?? (() => undefined)}
              onEditInChat={onEditEpicsInChat ?? (() => undefined)}
            />
          </div>
        </div>
      )}

      {/* ── Batch story review — shown once per epic after stories_ready ── */}
      {pendingStories !== undefined && onApproveAllStories && (
        <div className="flex gap-3 items-start max-w-[85%]">
          <div
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground text-xs font-bold"
          >
            AI
          </div>
          <div className="flex-1">
            <EpicStoriesReview
              epicTitle={pendingEpicTitle ?? ''}
              stories={pendingStories}
              onEditStory={onEditStory ?? (() => undefined)}
              onRemoveStory={onRemoveStory ?? (() => undefined)}
              onAddStory={onAddStory ?? (() => undefined)}
              onApproveAll={onApproveAllStories}
            />
          </div>
        </div>
      )}

      {showThinking && (
        <div className="flex gap-3 items-center">
          <div
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground text-xs font-bold"
          >
            AI
          </div>
          <div className="flex gap-1 items-center px-4 py-3 rounded-lg border border-l-4 border-l-accent bg-card">
            <span className="h-2 w-2 rounded-full bg-accent animate-bounce" style={{ animationDelay: '0ms' }} aria-hidden="true" />
            <span className="h-2 w-2 rounded-full bg-accent animate-bounce" style={{ animationDelay: '150ms' }} aria-hidden="true" />
            <span className="h-2 w-2 rounded-full bg-accent animate-bounce" style={{ animationDelay: '300ms' }} aria-hidden="true" />
            <span className="sr-only">Thinking…</span>
          </div>
        </div>
      )}

      {/* Context hint banner */}
      {contextLevel === 'warn' && (
        <ContextHintBanner
          level="warn"
          pct={contextPct}
          onFinishSection={onFinishSection}
        />
      )}

      <div ref={bottomRef} />
    </div>
  );
}
