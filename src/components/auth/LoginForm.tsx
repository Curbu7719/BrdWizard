import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

interface LoginFormProps {
  onSubmit: (email: string, password: string) => Promise<{ error: string | null }>;
}

export function LoginForm({ onSubmit }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await onSubmit(email, password);
    setLoading(false);
    if (result.error) setError('Invalid username or password');
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email">Username</Label>
        <Input
          id="email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={loading}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          placeholder="••••••••••••"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          disabled={loading}
          required
        />
      </div>

      <Button type="submit" className="w-full" loading={loading} disabled={!email || !password}>
        Sign In
      </Button>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}
    </form>
  );
}
