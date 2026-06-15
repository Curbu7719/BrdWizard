import { AlertTriangle, X } from 'lucide-react';
import { useState } from 'react';
import type { ContextWarningLevel } from '../../hooks/useChat';

interface ContextHintBannerProps {
  level: ContextWarningLevel;
  pct?: number;
  onFinishSection?: () => void;
}

export function ContextHintBanner({ level, pct, onFinishSection }: ContextHintBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (level === 'none' || (level === 'warn' && dismissed)) return null;

  if (level === 'warn') {
    return (
      <div
        role="status"
        className="rounded-md border-l-4 border-l-warning bg-warning/5 border border-warning/20 px-4 py-3 flex items-start gap-3"
      >
        <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 text-sm text-warning">
          Context is {pct ?? '~70'}% full. Consider wrapping up the current section to keep things running smoothly.
          {onFinishSection && (
            <button
              className="ml-2 underline hover:no-underline font-medium"
              onClick={onFinishSection}
            >
              Finish Section
            </button>
          )}
        </div>
        <button
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="text-warning hover:text-warning/80 focus:outline-none"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  // checkpoint and handoff are rendered as system messages in chat — nothing extra here
  return null;
}
