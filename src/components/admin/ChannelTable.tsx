import { useState } from 'react';
import { Pencil, Check, X, Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { toast } from '../../hooks/useToast';
import type { Channel } from '../../types/brd';

interface ChannelTableProps {
  channels: Channel[];
  onRefetch: () => void;
}

interface EditState {
  label: string;
  code: string;
  sort_order: number;
  is_active: boolean;
}

export function ChannelTable({ channels, onRefetch }: ChannelTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ label: '', code: '', sort_order: 0, is_active: true });
  const [saving, setSaving] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [newRow, setNewRow] = useState<Omit<EditState, 'is_active'>>({ label: '', code: '', sort_order: channels.length + 1 });

  function startEdit(ch: Channel) {
    setEditingId(ch.id);
    setEditState({ label: ch.label, code: ch.code, sort_order: ch.sort_order, is_active: ch.is_active });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: string) {
    setSaving(true);
    const { error } = await supabase
      .from('channels')
      .update({ label: editState.label, sort_order: editState.sort_order, is_active: editState.is_active, updated_at: new Date().toISOString() })
      .eq('id', id);
    setSaving(false);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    } else {
      setEditingId(null);
      onRefetch();
    }
  }

  async function toggleActive(id: string, current: boolean) {
    const { error } = await supabase
      .from('channels')
      .update({ is_active: !current, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
    else onRefetch();
  }

  async function addChannel() {
    if (!newRow.code.trim() || !newRow.label.trim()) {
      toast({ title: 'Code and label are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('channels').insert({
      code: newRow.code.trim().toUpperCase(),
      label: newRow.label.trim(),
      sort_order: newRow.sort_order,
      is_active: true,
    });
    setSaving(false);
    if (error) {
      toast({ title: 'Add failed', description: error.message, variant: 'destructive' });
    } else {
      setAddingNew(false);
      setNewRow({ label: '', code: '', sort_order: channels.length + 2 });
      onRefetch();
    }
  }

  return (
    <div>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Code</th>
              <th className="text-left px-4 py-2.5 font-medium">Label</th>
              <th className="text-left px-4 py-2.5 font-medium w-20">Order</th>
              <th className="text-left px-4 py-2.5 font-medium w-20">Active</th>
              <th className="text-left px-4 py-2.5 font-medium w-32">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {channels.map(ch => (
              <tr
                key={ch.id}
                className={['transition-colors', !ch.is_active && 'opacity-50'].filter(Boolean).join(' ')}
              >
                {editingId === ch.id ? (
                  <>
                    <td className="px-4 py-2">
                      <span className="font-mono text-xs text-muted-foreground">{ch.code}</span>
                    </td>
                    <td className="px-4 py-2">
                      <Input
                        value={editState.label}
                        onChange={e => setEditState(p => ({ ...p, label: e.target.value }))}
                        className="h-7 text-sm"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <Input
                        type="number"
                        value={editState.sort_order}
                        onChange={e => setEditState(p => ({ ...p, sort_order: Number(e.target.value) }))}
                        className="h-7 text-sm w-16"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <Switch
                        checked={editState.is_active}
                        onCheckedChange={v => setEditState(p => ({ ...p, is_active: v }))}
                        aria-label="Active"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        <Button size="sm" loading={saving} onClick={() => saveEdit(ch.id)}>
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-2.5 font-mono text-xs">{ch.code}</td>
                    <td className="px-4 py-2.5">{ch.label}</td>
                    <td className="px-4 py-2.5">{ch.sort_order}</td>
                    <td className="px-4 py-2.5">
                      <Switch
                        checked={ch.is_active}
                        onCheckedChange={() => toggleActive(ch.id, ch.is_active)}
                        aria-label={`Toggle ${ch.label}`}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <Button size="sm" variant="outline" onClick={() => startEdit(ch)}>
                        <Pencil className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                        Edit
                      </Button>
                    </td>
                  </>
                )}
              </tr>
            ))}

            {/* Add new row */}
            {addingNew && (
              <tr className="bg-secondary/30">
                <td className="px-4 py-2">
                  <Input
                    placeholder="CODE"
                    value={newRow.code}
                    onChange={e => setNewRow(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                    className="h-7 text-sm font-mono uppercase"
                  />
                </td>
                <td className="px-4 py-2">
                  <Input
                    placeholder="Label"
                    value={newRow.label}
                    onChange={e => setNewRow(p => ({ ...p, label: e.target.value }))}
                    className="h-7 text-sm"
                  />
                </td>
                <td className="px-4 py-2">
                  <Input
                    type="number"
                    value={newRow.sort_order}
                    onChange={e => setNewRow(p => ({ ...p, sort_order: Number(e.target.value) }))}
                    className="h-7 text-sm w-16"
                  />
                </td>
                <td className="px-4 py-2">
                  <Switch checked aria-label="Active" />
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-1">
                    <Button size="sm" loading={saving} onClick={addChannel}>
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      Add
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAddingNew(false)} disabled={saving}>
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!addingNew && (
        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={() => setAddingNew(true)}>
            <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
            Add Channel
          </Button>
        </div>
      )}
    </div>
  );
}
