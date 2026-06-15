/**
 * Component tests for MessageBubble.
 *
 * Tests all five rendering variants described in UI-UX-SPEC.md §2.1:
 *   - user bubble (right-aligned)
 *   - assistant idle
 *   - assistant streaming (blinking cursor)
 *   - assistant error (with retry button)
 *   - assistant truncated (Continue? link)
 *   - system bubble (checkpoint, handoff)
 *
 * No Supabase dependency — component is pure presentational.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageBubble } from '../components/wizard/MessageBubble';
import type { ChatMessage } from '../hooks/useChat';

function makeMsg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'test-id',
    role: 'assistant',
    content: 'Default content',
    status: 'idle',
    ...overrides,
  };
}

describe('MessageBubble — user variant', () => {
  it('renders user message content', () => {
    render(<MessageBubble message={makeMsg({ role: 'user', content: 'Hello AI' })} />);
    expect(screen.getByText('Hello AI')).toBeInTheDocument();
  });

  it('does not render the AI avatar for user messages', () => {
    render(<MessageBubble message={makeMsg({ role: 'user', content: 'Test' })} />);
    expect(screen.queryByText('AI')).not.toBeInTheDocument();
  });

  it('preserves whitespace in user message (whitespace-pre-wrap)', () => {
    const text = 'Line 1\nLine 2';
    render(<MessageBubble message={makeMsg({ role: 'user', content: text })} />);
    // Use a custom normalizer because getByText collapses whitespace by default
    expect(
      screen.getByText((content) => content.includes('Line 1') && content.includes('Line 2'))
    ).toBeInTheDocument();
  });
});

describe('MessageBubble — assistant idle variant', () => {
  it('renders assistant message content', () => {
    render(<MessageBubble message={makeMsg({ role: 'assistant', content: 'Here is your answer.' })} />);
    expect(screen.getByText('Here is your answer.')).toBeInTheDocument();
  });

  it('renders the AI avatar', () => {
    render(<MessageBubble message={makeMsg({ role: 'assistant', content: 'Hi' })} />);
    expect(screen.getByText('AI')).toBeInTheDocument();
  });

  it('does NOT render the streaming cursor when status is idle', () => {
    render(<MessageBubble message={makeMsg({ role: 'assistant', status: 'idle', content: 'Done' })} />);
    // The blinking cursor has aria-hidden="true" and animate-pulse class
    const cursor = document.querySelector('.animate-pulse');
    expect(cursor).not.toBeInTheDocument();
  });
});

describe('MessageBubble — assistant streaming variant', () => {
  it('renders partial text during streaming', () => {
    render(
      <MessageBubble
        message={makeMsg({ role: 'assistant', status: 'streaming', content: 'Typing…' })}
      />
    );
    expect(screen.getByText(/Typing/)).toBeInTheDocument();
  });

  it('renders the streaming cursor element when status is streaming', () => {
    render(
      <MessageBubble
        message={makeMsg({ role: 'assistant', status: 'streaming', content: 'Hello' })}
      />
    );
    // The cursor is aria-hidden, verify via class
    const cursor = document.querySelector('.animate-pulse');
    expect(cursor).toBeInTheDocument();
  });

  it('marks the streaming cursor as aria-hidden (decorative)', () => {
    render(
      <MessageBubble
        message={makeMsg({ role: 'assistant', status: 'streaming', content: 'Hi' })}
      />
    );
    const cursor = document.querySelector('[aria-hidden="true"].animate-pulse');
    expect(cursor).toBeInTheDocument();
  });
});

describe('MessageBubble — assistant error variant', () => {
  it('renders the error fallback text when content is empty', () => {
    render(
      <MessageBubble
        message={makeMsg({ role: 'assistant', status: 'error', content: '' })}
      />
    );
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
  });

  it('renders a custom error message', () => {
    render(
      <MessageBubble
        message={makeMsg({ role: 'assistant', status: 'error', content: 'Connection lost' })}
      />
    );
    expect(screen.getByText('Connection lost')).toBeInTheDocument();
  });

  it('renders the Retry button when onRetry is provided', () => {
    render(
      <MessageBubble
        message={makeMsg({ role: 'assistant', status: 'error', content: 'Oops' })}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('calls onRetry when Retry is clicked', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <MessageBubble
        message={makeMsg({ role: 'assistant', status: 'error', content: 'Oops' })}
        onRetry={onRetry}
      />
    );
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does NOT render Retry button when onRetry is not provided', () => {
    render(
      <MessageBubble
        message={makeMsg({ role: 'assistant', status: 'error', content: 'Oops' })}
      />
    );
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});

describe('MessageBubble — assistant truncated variant', () => {
  it('renders the cut-off notice', () => {
    render(
      <MessageBubble
        message={makeMsg({ role: 'assistant', status: 'truncated', content: 'Partial text' })}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByText(/response was cut off/i)).toBeInTheDocument();
  });

  it('renders the Continue? link', () => {
    render(
      <MessageBubble
        message={makeMsg({ role: 'assistant', status: 'truncated', content: 'Partial' })}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument();
  });

  it('calls onRetry when Continue? is clicked', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <MessageBubble
        message={makeMsg({ role: 'assistant', status: 'truncated', content: 'Partial' })}
        onRetry={onRetry}
      />
    );
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('MessageBubble — system variant', () => {
  it('renders a system checkpoint message', () => {
    render(
      <MessageBubble
        message={makeMsg({
          role: 'system',
          content: 'The current section has been automatically saved as a checkpoint. Continuing to the next section.',
          status: 'idle',
        })}
      />
    );
    expect(screen.getByText(/checkpoint/i)).toBeInTheDocument();
  });

  it('renders a system handoff message with Go to Dashboard button', () => {
    render(
      <MessageBubble
        message={makeMsg({
          role: 'system',
          content: 'Session limit reached. Your progress has been saved. Return to this BRD and the AI will resume from where you left off.',
          status: 'idle',
        })}
      />
    );
    expect(screen.getByText(/session limit/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to dashboard/i })).toBeInTheDocument();
  });

  it('marks the system bubble with role="status"', () => {
    render(
      <MessageBubble
        message={makeMsg({ role: 'system', content: 'System message', status: 'idle' })}
      />
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
