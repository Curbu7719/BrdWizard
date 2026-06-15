/**
 * Component tests for LoginForm.
 *
 * Per UI-UX-SPEC.md §S1 and the LoginForm implementation:
 *   - Renders username + password fields and Sign In button
 *   - Sign In is disabled when fields are empty
 *   - Sign In is enabled when both fields have values
 *   - On submit: calls onSubmit(email, password) and shows spinner
 *   - On error response: displays "Invalid username or password"
 *   - On success: error clears
 *   - Inputs disabled during loading
 *
 * No Supabase dependency — onSubmit is injected via props.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from '../components/auth/LoginForm';

function renderLoginForm(
  onSubmit: (email: string, password: string) => Promise<{ error: string | null }> = vi.fn().mockResolvedValue({ error: null })
) {
  return render(<LoginForm onSubmit={onSubmit} />);
}

describe('LoginForm — initial render', () => {
  it('renders the Username label and input', () => {
    renderLoginForm();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
  });

  it('renders the Password label and input', () => {
    renderLoginForm();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('renders the Sign In button', () => {
    renderLoginForm();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('Sign In button is disabled when both fields are empty', () => {
    renderLoginForm();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled();
  });

  it('does not show an error message initially', () => {
    renderLoginForm();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('LoginForm — button enabled state', () => {
  it('Sign In is disabled when only email is filled', async () => {
    const user = userEvent.setup();
    renderLoginForm();
    await user.type(screen.getByLabelText(/username/i), 'user@vodafone.com.tr');
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled();
  });

  it('Sign In is disabled when only password is filled', async () => {
    const user = userEvent.setup();
    renderLoginForm();
    await user.type(screen.getByLabelText(/password/i), 'secret123');
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled();
  });

  it('Sign In is enabled when both fields are filled', async () => {
    const user = userEvent.setup();
    renderLoginForm();
    await user.type(screen.getByLabelText(/username/i), 'user@vodafone.com.tr');
    await user.type(screen.getByLabelText(/password/i), 'secret123');
    expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled();
  });
});

describe('LoginForm — form submission', () => {
  it('calls onSubmit with the typed email and password', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ error: null });
    renderLoginForm(onSubmit);
    await user.type(screen.getByLabelText(/username/i), 'user@vodafone.com.tr');
    await user.type(screen.getByLabelText(/password/i), 'mypassword');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(onSubmit).toHaveBeenCalledWith('user@vodafone.com.tr', 'mypassword');
  });

  it('calls onSubmit when Enter is pressed in the password field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ error: null });
    renderLoginForm(onSubmit);
    await user.type(screen.getByLabelText(/username/i), 'user@vodafone.com.tr');
    await user.type(screen.getByLabelText(/password/i), 'mypassword{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('disables inputs and button while submitting', async () => {
    const user = userEvent.setup();
    // Use a never-resolving promise to hold the loading state
    let resolve!: (v: { error: string | null }) => void;
    const onSubmit = vi.fn().mockReturnValue(new Promise<{ error: string | null }>(r => { resolve = r; }));
    renderLoginForm(onSubmit);
    await user.type(screen.getByLabelText(/username/i), 'user@vodafone.com.tr');
    await user.type(screen.getByLabelText(/password/i), 'pass');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    // During loading the inputs are disabled
    expect(screen.getByLabelText(/username/i)).toBeDisabled();
    expect(screen.getByLabelText(/password/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled();
    // Cleanup
    resolve({ error: null });
  });
});

describe('LoginForm — error state', () => {
  it('shows "Invalid username or password" when onSubmit returns an error', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ error: 'Invalid login credentials' });
    renderLoginForm(onSubmit);
    await user.type(screen.getByLabelText(/username/i), 'bad@email.com');
    await user.type(screen.getByLabelText(/password/i), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/invalid username or password/i)).toBeInTheDocument();
    });
  });

  it('clears the error message on a successful subsequent submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn()
      .mockResolvedValueOnce({ error: 'bad' })
      .mockResolvedValueOnce({ error: null });
    renderLoginForm(onSubmit);
    await user.type(screen.getByLabelText(/username/i), 'u@e.com');
    await user.type(screen.getByLabelText(/password/i), 'p');
    // First submit → error
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // Second submit → success
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
