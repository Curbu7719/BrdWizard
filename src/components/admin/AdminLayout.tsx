import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const ADMIN_TABS = [
  { label: 'Channels', path: '/admin/channels' },
  { label: 'Context & Turns', path: '/admin/settings' },
  { label: 'Prompts', path: '/admin/prompts' },
  { label: 'Reports', path: '/admin/reports' },
] as const;

interface AdminLayoutProps {
  children: React.ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/95">
        <div className="flex h-14 items-center px-6 gap-3">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Dashboard
          </button>
          <span className="text-border mx-1">|</span>
          <h1 className="text-base font-semibold text-foreground">Admin — Settings</h1>
        </div>

        {/* Tab nav */}
        <nav className="flex gap-0 px-6 border-t border-border" aria-label="Admin sections">
          {ADMIN_TABS.map(tab => {
            const active = pathname === tab.path;
            return (
              <button
                key={tab.path}
                onClick={() => navigate(tab.path)}
                className={[
                  'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
                ].join(' ')}
                aria-current={active ? 'page' : undefined}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="px-6 py-8 max-w-4xl mx-auto">
        {children}
      </main>
    </div>
  );
}
