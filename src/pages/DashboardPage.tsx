import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, LogOut, ChevronDown } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useMyBrds, usePublicBrds, useBrdActions } from '../hooks/useBrd';
import { BrdList } from '../components/dashboard/BrdList';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../components/ui/dropdown-menu';
import { toast } from '../hooks/useToast';
import { Spinner } from '../components/shared/Spinner';

type Tab = 'my' | 'public';

export default function DashboardPage() {
  const { user, role, signOut, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('my');
  const [creating, setCreating] = useState(false);

  const { brds: myBrds, loading: myLoading, refetch: refetchMy } = useMyBrds();
  const { brds: publicBrds, loading: publicLoading } = usePublicBrds();
  const { createBrd } = useBrdActions();

  async function handleNew() {
    setCreating(true);
    const { id, error } = await createBrd();
    setCreating(false);
    if (error || !id) {
      toast({ title: 'Error', description: error ?? 'Could not create BRD.', variant: 'destructive' });
    } else {
      navigate(`/brd/${id}`);
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const displayName = user?.email ?? 'User';
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex h-14 items-center px-6 gap-4">
          <span className="flex items-center gap-2 font-bold text-foreground text-lg">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold">B</span>
            BRD Wizard
          </span>

          {/* Tabs */}
          <nav className="flex items-center gap-1 ml-4">
            <button
              onClick={() => setTab('my')}
              className={[
                'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
                tab === 'my'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50',
              ].join(' ')}
            >
              My BRDs
            </button>
            <button
              onClick={() => setTab('public')}
              className={[
                'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
                tab === 'public'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50',
              ].join(' ')}
            >
              All Public
            </button>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {role === 'admin' && (
              <Button size="sm" variant="outline" onClick={() => navigate('/admin/channels')}>
                Admin
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-foreground text-xs font-semibold">
                    {initials}
                  </span>
                  {displayName}
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="h-4 w-4 mr-2" aria-hidden="true" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="px-6 py-8 max-w-6xl mx-auto">
        {tab === 'my' && (
          <>
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-xl font-semibold text-foreground">My BRDs</h1>
              <Button onClick={handleNew} loading={creating}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New BRD
              </Button>
            </div>
            <BrdList
              brds={myBrds}
              loading={myLoading}
              currentUserId={user?.id}
              onNew={handleNew}
              onDeleted={refetchMy}
              onUpdated={refetchMy}
              showNewButton
            />
          </>
        )}

        {tab === 'public' && (
          <>
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-xl font-semibold text-foreground">All Public BRDs</h1>
            </div>
            <BrdList
              brds={publicBrds}
              loading={publicLoading}
              currentUserId={user?.id}
            />
          </>
        )}
      </main>
    </div>
  );
}
