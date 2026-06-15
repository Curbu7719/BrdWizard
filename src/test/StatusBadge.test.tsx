/**
 * Component tests for StatusBadge components.
 *
 * Covers:
 *   BrdStatusBadge: 'draft' | 'complete' variants
 *   SectionStatusBadge: 'pending' | 'in_progress' | 'approved' variants
 *
 * Per UI-UX-SPEC.md §5.4: status is conveyed by color AND icon AND text.
 * We verify the text label is present (color/icon are visual; CSS not loaded in tests).
 *
 * No Supabase dependency — pure presentational.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrdStatusBadge, SectionStatusBadge } from '../components/shared/StatusBadge';

describe('BrdStatusBadge', () => {
  it('renders "Draft" label for draft status', () => {
    render(<BrdStatusBadge status="draft" />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('renders "Complete" label for complete status', () => {
    render(<BrdStatusBadge status="complete" />);
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('accepts optional className without crashing', () => {
    const { container } = render(<BrdStatusBadge status="draft" className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });
});

describe('SectionStatusBadge', () => {
  it('renders "Pending" label for pending status', () => {
    render(<SectionStatusBadge status="pending" />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('renders "In progress" label for in_progress status', () => {
    render(<SectionStatusBadge status="in_progress" />);
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });

  it('renders "Approved" label for approved status', () => {
    render(<SectionStatusBadge status="approved" />);
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('accepts optional className without crashing', () => {
    const { container } = render(<SectionStatusBadge status="approved" className="test-cls" />);
    expect(container.firstChild).toHaveClass('test-cls');
  });
});
