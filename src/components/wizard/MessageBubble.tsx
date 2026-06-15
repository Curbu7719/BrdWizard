import { AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import type { ChatMessage } from '../../hooks/useChat';

interface MessageBubbleProps {
  message: ChatMessage;
  onRetry?: () => void;
}

// The agent appends machine-readable XML blocks (<section_draft>, <epics>,
// <stories>) at the END of its response — these drive the approval UI and must
// never be shown verbatim in the chat. Cut the displayed text at the first such
// (complete or partial) opening tag so nothing leaks, including mid-stream.
const STRUCTURED_TAGS = ['<section_draft', '<epics', '<stories'];
function stripStructuredBlocks(text: string): string {
  let cut = text.length;
  for (const tag of STRUCTURED_TAGS) {
    const i = text.indexOf(tag);
    if (i !== -1) cut = Math.min(cut, i);
  }
  // Hide a trailing partial opening tag still streaming in, e.g. "<sect".
  const lt = text.lastIndexOf('<');
  if (lt > -1 && lt >= text.length - 14) {
    const frag = text.slice(lt);
    if (STRUCTURED_TAGS.some((t) => t.startsWith(frag))) cut = Math.min(cut, lt);
  }
  return text.slice(0, cut).trimEnd();
}

export function MessageBubble({ message, onRetry }: MessageBubbleProps) {
  const { role, status } = message;
  const content =
    role === 'assistant' ? stripStructuredBlocks(message.content) : message.content;

  if (role === 'system') {
    const isHandoff = content.toLowerCase().includes('session limit');
    const isCheckpoint = content.toLowerCase().includes('checkpoint');
    return (
      <div
        role="status"
        className={cn(
          'text-xs rounded-md px-4 py-2 text-center border',
          isHandoff
            ? 'bg-accent/10 border-accent/30 text-accent'
            : isCheckpoint
            ? 'bg-muted border-border text-muted-foreground'
            : 'bg-muted border-border text-muted-foreground'
        )}
      >
        {content}
        {isHandoff && (
          <Button
            size="sm"
            variant="outline"
            className="mt-2 block mx-auto"
            onClick={() => window.location.href = '/'}
          >
            Go to Dashboard
          </Button>
        )}
      </div>
    );
  }

  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-secondary px-4 py-3 text-base text-foreground">
          <p className="whitespace-pre-wrap break-words">{content}</p>
        </div>
      </div>
    );
  }

  // Assistant
  return (
    <div className="flex gap-3 items-start max-w-[85%]">
      {/* Avatar */}
      <div
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground text-xs font-bold"
      >
        AI
      </div>

      <div
        className={cn(
          'rounded-lg border px-4 py-3 text-base text-foreground',
          status === 'error'
            ? 'bg-destructive/5 border-destructive/30'
            : status === 'truncated'
            ? 'bg-warning/5 border-warning/30'
            : 'bg-card border-l-4 border-l-accent border-border',
        )}
      >
        {status === 'error' ? (
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{content || 'Something went wrong. Try again.'}</span>
            {onRetry && (
              <Button size="sm" variant="ghost" onClick={onRetry} className="ml-2">
                <RefreshCw className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                Retry
              </Button>
            )}
          </div>
        ) : (
          <>
            <p className="whitespace-pre-wrap break-words">
              {content}
              {status === 'streaming' && (
                <span aria-hidden="true" className="ml-0.5 inline-block w-0.5 h-4 bg-accent animate-pulse align-middle" />
              )}
            </p>
            {status === 'truncated' && (
              <p className="mt-2 text-sm text-warning border-t border-warning/20 pt-2">
                Response was cut off.{' '}
                <button className="underline hover:no-underline" onClick={onRetry}>
                  Continue?
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
