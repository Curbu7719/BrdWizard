/**
 * Component tests for StoryApprovalCard.
 *
 * Per UI-UX-SPEC.md §2.4:
 *   - Shows user story text with Approve / Rewrite… buttons
 *   - "Rewrite…" expands an inline textarea pre-populated with the story text
 *   - "Save My Version" calls onSaveEdit with storyId + edited text
 *   - "Cancel" collapses textarea and restores original view
 *   - "Save My Version" is disabled when textarea is empty
 *   - Escape key in textarea cancels rewrite
 *   - Focus management: textarea gets focus when rewrite opens
 *   - Approve button calls onApprove(storyId)
 *   - All interactive elements disabled when disabled prop is true
 *   - Has role="region" with descriptive aria-label
 *
 * No Supabase dependency.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StoryApprovalCard } from '../components/wizard/StoryApprovalCard';
import type { UserStory } from '../types/brd';

function makeStory(overrides: Partial<UserStory> = {}): UserStory {
  return {
    id: 'story-1',
    epic_id: 'epic-1',
    brd_id: 'brd-1',
    persona: 'store employee',
    action: 'view subscriber invoices on SOT channel',
    channel_hint: 'SOT',
    full_text:
      'As a store employee, if I have permission, I should be able to view the subscriber\'s invoice on the SOT channel.',
    is_approved: false,
    is_edited: false,
    sort_order: 1,
    ...overrides,
  };
}

const EPIC_TITLE = 'Invoice Viewing';

describe('StoryApprovalCard — rendering', () => {
  it('renders the story full_text', () => {
    render(
      <StoryApprovalCard
        story={makeStory()}
        epicTitle={EPIC_TITLE}
        onApprove={vi.fn()}
        onSaveEdit={vi.fn()}
      />
    );
    expect(screen.getByText(/view the subscriber's invoice on the SOT channel/i)).toBeInTheDocument();
  });

  it('renders the "User Story" heading', () => {
    render(
      <StoryApprovalCard
        story={makeStory()}
        epicTitle={EPIC_TITLE}
        onApprove={vi.fn()}
        onSaveEdit={vi.fn()}
      />
    );
    expect(screen.getByText('User Story')).toBeInTheDocument();
  });

  it('has role="region" with aria-label referencing epicTitle', () => {
    render(
      <StoryApprovalCard
        story={makeStory()}
        epicTitle={EPIC_TITLE}
        onApprove={vi.fn()}
        onSaveEdit={vi.fn()}
      />
    );
    expect(screen.getByRole('region', { name: /Invoice Viewing/i })).toBeInTheDocument();
  });

  it('renders Approve and Rewrite buttons in default state', () => {
    render(
      <StoryApprovalCard
        story={makeStory()}
        epicTitle={EPIC_TITLE}
        onApprove={vi.fn()}
        onSaveEdit={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rewrite/i })).toBeInTheDocument();
  });
});

describe('StoryApprovalCard — Approve action', () => {
  it('calls onApprove with storyId when Approve is clicked', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    render(
      <StoryApprovalCard
        story={makeStory({ id: 'story-42' })}
        epicTitle={EPIC_TITLE}
        onApprove={onApprove}
        onSaveEdit={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: /^approve$/i }));
    expect(onApprove).toHaveBeenCalledWith('story-42');
  });

  it('disables Approve when disabled prop is true', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    render(
      <StoryApprovalCard
        story={makeStory()}
        epicTitle={EPIC_TITLE}
        onApprove={onApprove}
        onSaveEdit={vi.fn()}
        disabled
      />
    );
    await user.click(screen.getByRole('button', { name: /^approve$/i }));
    expect(onApprove).not.toHaveBeenCalled();
  });
});

describe('StoryApprovalCard — Rewrite flow', () => {
  it('opens the rewrite textarea when Rewrite… is clicked', async () => {
    const user = userEvent.setup();
    render(
      <StoryApprovalCard
        story={makeStory()}
        epicTitle={EPIC_TITLE}
        onApprove={vi.fn()}
        onSaveEdit={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: /rewrite/i }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('pre-populates textarea with the current story text', async () => {
    const user = userEvent.setup();
    const story = makeStory();
    render(
      <StoryApprovalCard
        story={story}
        epicTitle={EPIC_TITLE}
        onApprove={vi.fn()}
        onSaveEdit={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: /rewrite/i }));
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe(story.full_text);
  });

  it('hides the Approve / Rewrite buttons once rewrite is open', async () => {
    const user = userEvent.setup();
    render(
      <StoryApprovalCard
        story={makeStory()}
        epicTitle={EPIC_TITLE}
        onApprove={vi.fn()}
        onSaveEdit={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: /rewrite/i }));
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^rewrite/i })).not.toBeInTheDocument();
  });

  it('renders Save My Version and Cancel buttons in rewrite mode', async () => {
    const user = userEvent.setup();
    render(
      <StoryApprovalCard
        story={makeStory()}
        epicTitle={EPIC_TITLE}
        onApprove={vi.fn()}
        onSaveEdit={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: /rewrite/i }));
    expect(screen.getByRole('button', { name: /save my version/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('calls onSaveEdit with storyId and edited text when Save My Version is clicked', async () => {
    const user = userEvent.setup();
    const onSaveEdit = vi.fn();
    render(
      <StoryApprovalCard
        story={makeStory({ id: 'story-7' })}
        epicTitle={EPIC_TITLE}
        onApprove={vi.fn()}
        onSaveEdit={onSaveEdit}
      />
    );
    await user.click(screen.getByRole('button', { name: /rewrite/i }));
    const textarea = screen.getByRole('textbox');
    await user.clear(textarea);
    await user.type(textarea, 'My custom story text');
    await user.click(screen.getByRole('button', { name: /save my version/i }));
    expect(onSaveEdit).toHaveBeenCalledWith('story-7', 'My custom story text');
  });

  it('Cancel collapses rewrite mode and restores original view', async () => {
    const user = userEvent.setup();
    render(
      <StoryApprovalCard
        story={makeStory()}
        epicTitle={EPIC_TITLE}
        onApprove={vi.fn()}
        onSaveEdit={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: /rewrite/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    // Back to original state
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rewrite/i })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('Cancel resets the textarea text back to original story', async () => {
    const user = userEvent.setup();
    const story = makeStory();
    render(
      <StoryApprovalCard
        story={story}
        epicTitle={EPIC_TITLE}
        onApprove={vi.fn()}
        onSaveEdit={vi.fn()}
      />
    );
    // Open, edit, cancel, reopen and check text is reset
    await user.click(screen.getByRole('button', { name: /rewrite/i }));
    const textarea = screen.getByRole('textbox');
    await user.clear(textarea);
    await user.type(textarea, 'Edited text');
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    // Reopen
    await user.click(screen.getByRole('button', { name: /rewrite/i }));
    const freshTextarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(freshTextarea.value).toBe(story.full_text);
  });

  it('Escape key in textarea cancels rewrite', async () => {
    const user = userEvent.setup();
    render(
      <StoryApprovalCard
        story={makeStory()}
        epicTitle={EPIC_TITLE}
        onApprove={vi.fn()}
        onSaveEdit={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: /rewrite/i }));
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, '{Escape}');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument();
  });

  it('Save My Version is disabled when textarea is empty', async () => {
    const user = userEvent.setup();
    render(
      <StoryApprovalCard
        story={makeStory()}
        epicTitle={EPIC_TITLE}
        onApprove={vi.fn()}
        onSaveEdit={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: /rewrite/i }));
    const textarea = screen.getByRole('textbox');
    await user.clear(textarea);
    expect(screen.getByRole('button', { name: /save my version/i })).toBeDisabled();
  });

  it('Save My Version is enabled when textarea has content', async () => {
    const user = userEvent.setup();
    render(
      <StoryApprovalCard
        story={makeStory()}
        epicTitle={EPIC_TITLE}
        onApprove={vi.fn()}
        onSaveEdit={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: /rewrite/i }));
    expect(screen.getByRole('button', { name: /save my version/i })).not.toBeDisabled();
  });

  it('disables the Rewrite button when disabled prop is true', () => {
    // When disabled=true the Rewrite button itself is disabled, preventing
    // the user from opening the rewrite textarea at all.
    render(
      <StoryApprovalCard
        story={makeStory()}
        epicTitle={EPIC_TITLE}
        onApprove={vi.fn()}
        onSaveEdit={vi.fn()}
        disabled
      />
    );
    expect(screen.getByRole('button', { name: /rewrite/i })).toBeDisabled();
  });
});
