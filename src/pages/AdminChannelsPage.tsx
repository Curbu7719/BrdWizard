import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { AdminLayout } from '../components/admin/AdminLayout';
import { ChannelTable } from '../components/admin/ChannelTable';
import { Spinner } from '../components/shared/Spinner';
import type { Channel } from '../types/brd';

export default function AdminChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('channels')
      .select('*')
      .order('sort_order');
    setChannels((data as Channel[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-foreground">Impacted Channels</h2>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : (
        <ChannelTable channels={channels} onRefetch={load} />
      )}
    </AdminLayout>
  );
}
