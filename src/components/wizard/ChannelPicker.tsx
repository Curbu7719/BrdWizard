import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { cn } from '../../lib/utils';
import { Spinner } from '../shared/Spinner';
import type { Channel } from '../../types/brd';

interface ChannelPickerProps {
  selected: string[];
  onChange: (codes: string[]) => void;
  disabled?: boolean;
}

export function ChannelPicker({ selected, onChange, disabled }: ChannelPickerProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('channels')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        setChannels((data as Channel[]) ?? []);
        setLoading(false);
      });
  }, []);

  function toggle(code: string) {
    if (disabled) return;
    if (selected.includes(code)) {
      onChange(selected.filter(c => c !== code));
    } else {
      onChange([...selected, code]);
    }
  }

  if (loading) return <Spinner size="sm" />;

  return (
    <div
      role="group"
      aria-label="Impacted Channels"
      className="flex flex-wrap gap-2"
    >
      {channels.map(ch => {
        const active = selected.includes(ch.code);
        return (
          <button
            key={ch.code}
            type="button"
            role="checkbox"
            aria-checked={active}
            disabled={disabled}
            onClick={() => toggle(ch.code)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              active
                ? 'bg-primary text-primary-foreground'
                : 'border border-border text-muted-foreground hover:border-accent hover:text-accent'
            )}
          >
            {ch.label}
            {active && (
              <X className="h-3 w-3" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}
