/**
 * Component tests for EpicProposalCard.
 *
 * Per UI-UX-SPEC.md §2.3:
 *   - Lists proposed epics with title + description
 *   - "Approve All Epics" button → calls onApproveAll
 *   - "Edit in Chat" button → calls onEditInChat
 *   - Buttons are disabled when disabled prop is true
 *   - Has role="region" with aria-label="Proposed Epics"
 *
 * No Supabase dependency — pure presentational component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EpicProposalCard } from '../components/wizard/EpicProposalCard';
import type { Epic } from '../types/brd';

function makeEpic(overrides: Partial<Epic> = {}): Epic {
  return {
    id: 'epic-1',
    brd_id: 'brd-1',
    section_id: null,
    title: 'Invoice Viewing',
    description: 'Store employees view subscriber invoices on SOT channel.',
    sort_order: 1,
    is_approved: false,
    ...overrides,
  };
}

const defaultEpics: Epic[] = [
  makeEpic({ id: 'e1', title: 'Invoice Viewing', sort_order: 1 }),
  makeEpic({ id: 'e2', title: 'Permission Management', description: 'Role-based access control.', sort_order: 2 }),
  makeEpic({ id: 'e3', title: 'Audit Trail', description: 'Log all invoice access events.', sort_order: 3 }),
];

describe('EpicProposalCard — rendering', () => {
  it('renders the "Proposed Epics" heading', () => {
    render(<EpicProposalCard epics={defaultEpics} onApproveAll={vi.fn()} onEditInChat={vi.fn()} />);
    expect(screen.getByText('Proposed Epics')).toBeInTheDocument();
  });

  it('renders all epic titles', () => {
    render(<EpicProposalCard epics={defaultEpics} onApproveAll={vi.fn()} onEditInChat={vi.fn()} />);
    expect(screen.getByText('Invoice Viewing')).toBeInTheDocument();
    expect(screen.getByText('Permission Management')).toBeInTheDocument();
    expect(screen.getByText('Audit Trail')).toBeInTheDocument();
  });

  it('renders epic descriptions when present', () => {
    render(<EpicProposalCard epics={defaultEpics} onApproveAll={vi.fn()} onEditInChat={vi.fn()} />);
    expect(screen.getByText('Role-based access control.')).toBeInTheDocument();
    expect(screen.getByText('Log all invoice access events.')).toBeInTheDocument();
  });

  it('renders numbered list items', () => {
    render(<EpicProposalCard epics={defaultEpics} onApproveAll={vi.fn()} onEditInChat={vi.fn()} />);
    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
    expect(screen.getByText('3.')).toBeInTheDocument();
  });

  it('renders with an empty epics list without crashing', () => {
    render(<EpicProposalCard epics={[]} onApproveAll={vi.fn()} onEditInChat={vi.fn()} />);
    expect(screen.getByText('Proposed Epics')).toBeInTheDocument();
  });

  it('has role="region" with aria-label="Proposed Epics"', () => {
    render(<EpicProposalCard epics={defaultEpics} onApproveAll={vi.fn()} onEditInChat={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Proposed Epics' })).toBeInTheDocument();
  });
});

describe('EpicProposalCard — buttons', () => {
  it('renders the Approve All Epics button', () => {
    render(<EpicProposalCard epics={defaultEpics} onApproveAll={vi.fn()} onEditInChat={vi.fn()} />);
    expect(screen.getByRole('button', { name: /approve all epics/i })).toBeInTheDocument();
  });

  it('renders the Edit in Chat button', () => {
    render(<EpicProposalCard epics={defaultEpics} onApproveAll={vi.fn()} onEditInChat={vi.fn()} />);
    expect(screen.getByRole('button', { name: /edit in chat/i })).toBeInTheDocument();
  });

  it('calls onApproveAll when Approve All Epics is clicked', async () => {
    const user = userEvent.setup();
    const onApproveAll = vi.fn();
    render(<EpicProposalCard epics={defaultEpics} onApproveAll={onApproveAll} onEditInChat={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /approve all epics/i }));
    expect(onApproveAll).toHaveBeenCalledTimes(1);
  });

  it('calls onEditInChat when Edit in Chat is clicked', async () => {
    const user = userEvent.setup();
    const onEditInChat = vi.fn();
    render(<EpicProposalCard epics={defaultEpics} onApproveAll={vi.fn()} onEditInChat={onEditInChat} />);
    await user.click(screen.getByRole('button', { name: /edit in chat/i }));
    expect(onEditInChat).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons when disabled prop is true', () => {
    render(
      <EpicProposalCard epics={defaultEpics} onApproveAll={vi.fn()} onEditInChat={vi.fn()} disabled />
    );
    expect(screen.getByRole('button', { name: /approve all epics/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /edit in chat/i })).toBeDisabled();
  });

  it('does NOT call onApproveAll when button is disabled', async () => {
    const user = userEvent.setup();
    const onApproveAll = vi.fn();
    render(
      <EpicProposalCard epics={defaultEpics} onApproveAll={onApproveAll} onEditInChat={vi.fn()} disabled />
    );
    await user.click(screen.getByRole('button', { name: /approve all epics/i }));
    expect(onApproveAll).not.toHaveBeenCalled();
  });
});
