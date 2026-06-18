import { cn } from '../../lib/utils';
import type { ChatUsage } from '../../hooks/useChat';

interface ChatUsageBarProps {
  usage: ChatUsage;
}

/**
 * Slim status bar shown below the chat: context-window usage (% of the model's
 * input window) plus the latest turn's input/output token counts. Values come
 * from the backend `usage` SSE event (or the last persisted turn on resume).
 */
export function ChatUsageBar({ usage }: ChatUsageBarProps) {
  const pct = Math.max(0, Math.min(100, Math.round(usage.contextPct)));
  // Thresholds mirror warn(30%) / checkpoint(50%) / handoff(80%) of the window.
  const barColor = pct >= 80 ? 'bg-destructive' : pct >= 50 ? 'bg-warning' : 'bg-accent';
  const fmt = (n: number) => n.toLocaleString();

  return (
    <div className="shrink-0 border-t border-border bg-background/60 px-4 py-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
      <span className="shrink-0">Context {pct}%</span>
      <div
        className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-12"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Context window usage"
      >
        <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 tabular-nums" title="Last turn: input / output tokens">
        ↑ {fmt(usage.inputTokens)} · ↓ {fmt(usage.outputTokens)} tok
      </span>
    </div>
  );
}
