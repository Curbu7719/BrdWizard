import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LoginForm } from '../components/auth/LoginForm';

export default function LoginPage() {
  const { session, loading, signIn } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && session) {
      navigate('/', { replace: true });
    }
  }, [session, loading, navigate]);

  async function handleSubmit(email: string, password: string) {
    const result = await signIn(email, password);
    if (!result.error) {
      navigate('/', { replace: true });
    }
    return result;
  }

  if (loading) return null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-secondary px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo / wordmark */}
        <div className="text-center space-y-1">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-primary text-primary-foreground text-2xl font-bold mb-2">
            B
          </div>
          <h1 className="text-2xl font-bold text-foreground">BRD Wizard</h1>
          <p className="text-sm text-muted-foreground">Vodafone Turkey CBU</p>
        </div>

        {/* Card */}
        <div className="rounded-lg border border-border bg-card p-6 shadow-[0_1px_3px_rgba(0,0,0,0.10)]">
          <LoginForm onSubmit={handleSubmit} />
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Internal tool — Vodafone Turkey, CBU Team
        </p>
      </div>
    </main>
  );
}
