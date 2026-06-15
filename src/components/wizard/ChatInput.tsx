import { useRef, useState, useCallback } from 'react';
import { Paperclip, Send, X, AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { INPUT_LIMITS } from '../../lib/limits';

const MAX_FILE_SIZE_MB = 10;
const ACCEPTED_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

interface ChatInputProps {
  onSend: (text: string, file?: File) => void;
  disabled?: boolean;
  streaming?: boolean;
  /** When set, show a "Draft <label> for approval" button above the input row. */
  draftButtonLabel?: string;
  onDraftSection?: () => void;
}

export function ChatInput({ onSend, disabled, streaming, draftButtonLabel, onDraftSection }: ChatInputProps) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = !disabled && !streaming && text.trim().length > 0;

  function autoResize() {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const lineH = parseInt(getComputedStyle(ta).lineHeight, 10) || 24;
    ta.style.height = Math.min(ta.scrollHeight, lineH * 4) + 'px';
  }

  const handleSend = useCallback(() => {
    if (!canSend) return;
    onSend(text.trim(), file ?? undefined);
    setText('');
    setFile(null);
    setFileError(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      // preventScroll so re-focusing the input never nudges the page.
      textareaRef.current.focus({ preventScroll: true });
    }
  }, [canSend, text, file, onSend]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      setText('');
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileError(null);

    if (f.type !== ACCEPTED_TYPE && !f.name.endsWith('.docx')) {
      setFileError('Only .docx files are supported.');
      e.target.value = '';
      return;
    }
    if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setFileError(`File exceeds ${MAX_FILE_SIZE_MB} MB limit.`);
      e.target.value = '';
      return;
    }
    setFile(f);
    e.target.value = '';
  }

  return (
    <div className="border-t border-border bg-background px-4 py-3">
      {/* Attached file chip */}
      {file && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs bg-secondary text-foreground rounded-full px-3 py-1 flex items-center gap-1.5 max-w-xs truncate">
            <Paperclip className="h-3 w-3 shrink-0" aria-hidden="true" />
            {file.name}
            <button
              onClick={() => setFile(null)}
              aria-label="Remove attachment"
              className="ml-1 hover:text-destructive focus:outline-none"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        </div>
      )}

      {/* File error */}
      {fileError && (
        <p className="flex items-center gap-1 text-xs text-destructive mb-2">
          <AlertCircle className="h-3 w-3" aria-hidden="true" />
          {fileError}
        </p>
      )}

      {/* Draft-section trigger — shown only when the parent decides it is appropriate */}
      {draftButtonLabel && onDraftSection && (
        <div className="mb-2">
          <button
            type="button"
            onClick={onDraftSection}
            className={cn(
              'w-full rounded-[6px] border border-dashed border-accent/60 bg-accent/5 px-3 py-2',
              'text-xs font-medium text-accent hover:bg-accent/10 hover:border-accent',
              'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            Draft {draftButtonLabel} for approval
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={handleFileSelect}
          className="sr-only"
          aria-label="Attach Word document"
        />

        {/* Attach button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          aria-label="Attach Word document"
          className={cn(
            'h-11 w-11 flex items-center justify-center rounded-[6px] border border-border text-muted-foreground',
            'hover:text-foreground hover:bg-secondary transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:opacity-40 disabled:cursor-not-allowed shrink-0'
          )}
        >
          <Paperclip className="h-4 w-4" aria-hidden="true" />
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder="Type your message…"
          value={text}
          onChange={e => { setText(e.target.value); autoResize(); }}
          onKeyDown={handleKeyDown}
          disabled={disabled || streaming}
          maxLength={INPUT_LIMITS.chatMessage.max}
          aria-label="Chat message"
          className={cn(
            'flex-1 resize-none rounded-[6px] border border-input bg-background px-3 py-2.5 text-sm',
            'placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-40',
            'min-h-[44px] max-h-[112px] overflow-y-auto'
          )}
        />

        {/* Send button */}
        <Button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          size="sm"
          className="h-11 px-4 shrink-0"
          aria-label="Send message"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {/* Character counter — only surfaces as you approach the limit */}
      {text.length > INPUT_LIMITS.chatMessage.max * 0.8 && (
        <p className="mt-1 text-right text-xs text-muted-foreground">
          {text.length.toLocaleString()} / {INPUT_LIMITS.chatMessage.max.toLocaleString()}
        </p>
      )}
    </div>
  );
}
