import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { BrdDocument, BrdVisibility } from '../types/brd';

export function useMyBrds() {
  const [brds, setBrds] = useState<BrdDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data, error: err } = await supabase
      .from('brd_documents')
      .select('*')
      .eq('owner_id', user.id)
      .order('updated_at', { ascending: false });

    if (err) setError(err.message);
    else setBrds((data as BrdDocument[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { brds, loading, error, refetch: load };
}

export function usePublicBrds() {
  const [brds, setBrds] = useState<BrdDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    supabase
      .from('brd_documents')
      .select('*')
      .eq('visibility', 'public')
      .order('updated_at', { ascending: false })
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else setBrds((data as BrdDocument[]) ?? []);
        setLoading(false);
      });
  }, []);

  return { brds, loading, error };
}

export function useBrdDocument(id: string) {
  const [brd, setBrd] = useState<BrdDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Only the FIRST load shows the full-screen loader. Background refetches
  // (after every message / approval) must be silent — otherwise the workspace
  // unmounts to a spinner and back, which looks like a full page refresh.
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!loadedRef.current) setLoading(true);
    const { data, error: err } = await supabase
      .from('brd_documents')
      .select('*')
      .eq('id', id)
      .single();
    if (err) setError(err.message);
    else setBrd(data as BrdDocument);
    loadedRef.current = true;
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  return { brd, loading, error, refetch: load };
}

export function useBrdActions() {
  async function createBrd(): Promise<{ id: string | null; error: string | null }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { id: null, error: 'Not authenticated' };

    const { data, error } = await supabase
      .from('brd_documents')
      .insert({ owner_id: user.id, title: 'Untitled BRD' })
      .select('id')
      .single();

    if (error) return { id: null, error: error.message };
    return { id: (data as { id: string }).id, error: null };
  }

  async function updateBrd(
    id: string,
    patch: Partial<Pick<BrdDocument, 'title' | 'visibility' | 'product_type' | 'mobility_type' | 'change_type' | 'impacted_channels' | 'status'>>
  ): Promise<{ error: string | null }> {
    const { error } = await supabase
      .from('brd_documents')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return { error: error.message };
    return { error: null };
  }

  async function deleteBrd(id: string): Promise<{ error: string | null }> {
    const { error } = await supabase.from('brd_documents').delete().eq('id', id);
    if (error) return { error: error.message };
    return { error: null };
  }

  async function toggleVisibility(
    id: string,
    current: BrdVisibility
  ): Promise<{ error: string | null }> {
    const next: BrdVisibility = current === 'public' ? 'private' : 'public';
    return updateBrd(id, { visibility: next });
  }

  return { createBrd, updateBrd, deleteBrd, toggleVisibility };
}
