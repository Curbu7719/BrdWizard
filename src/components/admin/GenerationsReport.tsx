import { useEffect, useState } from 'react';
import { Spinner } from '../shared/Spinner';
import { toast } from '../../hooks/useToast';
import { callEdgeFunctionGet } from '../../lib/sse';

interface GenerationRow {
  id: string;
  brd_id: string | null;
  title: string;
  score: number | null;
  created_at: string;
  user_name: string;
}

interface GenerationsResponse {
  generations: GenerationRow[];
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function scoreClass(score: number | null): string {
  if (score === null) return 'text-muted-foreground';
  if (score >= 70) return 'text-success';
  if (score >= 50) return 'text-warning';
  return 'text-destructive';
}

export function GenerationsReport() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<GenerationRow[]>([]);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await callEdgeFunctionGet<GenerationsResponse>('settings-admin/generations');
    setLoading(false);
    if (error) {
      toast({ title: 'Failed to load report', description: error, variant: 'destructive' });
      return;
    }
    if (data?.generations) setRows(data.generations);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Generated BRDs</h2>
          <p className="text-sm text-muted-foreground">
            Every time a user generates a BRD, it is logged here with its readiness score.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="text-sm text-muted-foreground hover:text-foreground underline"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No BRDs have been generated yet.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">User</th>
                <th className="text-left px-4 py-2.5 font-medium">Project (BRD)</th>
                <th className="text-left px-4 py-2.5 font-medium w-24">Score</th>
                <th className="text-left px-4 py-2.5 font-medium w-44">Generated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-secondary/30">
                  <td className="px-4 py-2.5 text-foreground">{r.user_name}</td>
                  <td className="px-4 py-2.5 text-foreground">{r.title}</td>
                  <td className={`px-4 py-2.5 font-semibold tabular-nums ${scoreClass(r.score)}`}>
                    {r.score === null ? '—' : `${r.score}/100`}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDateTime(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
