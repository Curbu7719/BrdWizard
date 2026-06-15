/**
 * Component tests for ContextHintBanner.
 *
 * Per UI-UX-SPEC.md §2.6 the banner has three states driven by context %:
 *   - none   → renders nothing
 *   - warn   → amber banner with dismiss ×; dismissible by user
 *   - checkpoint / handoff → rendered as system messages in MessageBubble (not here)
 *
 * No Supabase dependency — pure presentational component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextHintBanner } from '../components/wizard/ContextHintBanner';

describe('ContextHintBanner — level=none', () => {
  it('renders nothing when level is none', () => {
    const { container } = render(<ContextHintBanner level="none" />);
    expect(container.firstChild).toBeNull();
  });
});

describe('ContextHintBanner — level=warn', () => {
  it('renders the warn banner', () => {
    render(<ContextHintBanner level="warn" pct={72} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('displays the context percentage', () => {
    render(<ContextHintBanner level="warn" pct={72} />);
    expect(screen.getByText(/72%/)).toBeInTheDocument();
  });

  it('uses a fallback ~70% label when pct is not provided', () => {
    render(<ContextHintBanner level="warn" />);
    expect(screen.getByText(/~70%/)).toBeInTheDocument();
  });

  it('renders the Finish Section button when onFinishSection is provided', () => {
    render(<ContextHintBanner level="warn" pct={70} onFinishSection={vi.fn()} />);
    expect(screen.getByRole('button', { name: /finish section/i })).toBeInTheDocument();
  });

  it('calls onFinishSection when the button is clicked', async () => {
    const user = userEvent.setup();
    const onFinishSection = vi.fn();
    render(<ContextHintBanner level="warn" pct={70} onFinishSection={onFinishSection} />);
    await user.click(screen.getByRole('button', { name: /finish section/i }));
    expect(onFinishSection).toHaveBeenCalledTimes(1);
  });

  it('does NOT render Finish Section when onFinishSection is absent', () => {
    render(<ContextHintBanner level="warn" pct={70} />);
    expect(screen.queryByRole('button', { name: /finish section/i })).not.toBeInTheDocument();
  });

  it('renders the dismiss button', () => {
    render(<ContextHintBanner level="warn" pct={72} />);
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('hides itself after the dismiss button is clicked', async () => {
    const user = userEvent.setup();
    render(<ContextHintBanner level="warn" pct={72} />);
    const dismiss = screen.getByRole('button', { name: /dismiss/i });
    await user.click(dismiss);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('re-shows banner if new render occurs after dismiss (independent state)', () => {
    // Mounting a new instance always shows it regardless of prior dismissed state
    const { unmount } = render(<ContextHintBanner level="warn" pct={72} />);
    unmount();
    render(<ContextHintBanner level="warn" pct={72} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('ContextHintBanner — level=checkpoint', () => {
  it('renders nothing for checkpoint (handled as system message in chat)', () => {
    const { container } = render(<ContextHintBanner level="checkpoint" />);
    expect(container.firstChild).toBeNull();
  });
});

describe('ContextHintBanner — level=handoff', () => {
  it('renders nothing for handoff (handled as system message in chat)', () => {
    const { container } = render(<ContextHintBanner level="handoff" />);
    expect(container.firstChild).toBeNull();
  });
});
