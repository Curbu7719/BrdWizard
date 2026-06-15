import { useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { callEdgeFunction } from '../lib/sse';
import type { BrdSection, Epic, UserStory } from '../types/brd';

export function useSections(brdId: string) {
  const [sections, setSections] = useState<BrdSection[]>([]);
  const [epics, setEpics] = useState<Epic[]>([]);
  const [stories, setStories] = useState<UserStory[]>([]);
  const [loading, setLoading] = useState(false);
  // Only the first load shows the skeleton; later refetches (after every turn)
  // are silent so the right panel doesn't flicker on each message.
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!loadedRef.current) setLoading(true);
    const [sectionsRes, epicsRes, storiesRes] = await Promise.all([
      supabase.from('brd_sections').select('*').eq('brd_id', brdId).order('sort_order'),
      supabase.from('epics').select('*').eq('brd_id', brdId).order('sort_order'),
      supabase.from('user_stories').select('*').eq('brd_id', brdId).order('sort_order'),
    ]);
    if (sectionsRes.data) setSections(sectionsRes.data as BrdSection[]);
    if (epicsRes.data) setEpics(epicsRes.data as Epic[]);
    if (storiesRes.data) setStories(storiesRes.data as UserStory[]);
    loadedRef.current = true;
    setLoading(false);
  }, [brdId]);

  const approveSection = useCallback(
    async (sectionKey: string, content: string) => {
      const { data, error } = await callEdgeFunction<{ summary_line: string; next_section: string }>(
        'section-checkpoint',
        { brd_id: brdId, section_key: sectionKey, approved_content: content, trigger: 'user_approval' }
      );
      if (!error) {
        setSections(prev =>
          prev.map(s =>
            s.section_key === sectionKey
              ? { ...s, status: 'approved', content_full: content, summary_line: data?.summary_line ?? s.summary_line }
              : s
          )
        );
      }
      // Return next_section so the caller can advance active_section synchronously.
      return { error, nextSection: data?.next_section ?? null };
    },
    [brdId]
  );

  const reopenSection = useCallback(
    async (sectionKey: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return { error: 'Not authenticated' };

      const baseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${baseUrl}/functions/v1/section-checkpoint`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ brd_id: brdId, section_key: sectionKey, action: 'reopen' }),
      });
      if (!res.ok) return { error: `Error ${res.status}` };
      setSections(prev =>
        prev.map(s => (s.section_key === sectionKey ? { ...s, status: 'in_progress' } : s))
      );
      return { error: null };
    },
    [brdId]
  );

  const approveEpics = useCallback(
    async (epicIds: string[]) => {
      await supabase
        .from('epics')
        .update({ is_approved: true, approved_at: new Date().toISOString() })
        .in('id', epicIds);
      setEpics(prev => prev.map(e => (epicIds.includes(e.id) ? { ...e, is_approved: true } : e)));
    },
    []
  );

  const approveStory = useCallback(
    async (storyId: string) => {
      await supabase
        .from('user_stories')
        .update({ is_approved: true, approved_at: new Date().toISOString() })
        .eq('id', storyId);
      setStories(prev => prev.map(s => (s.id === storyId ? { ...s, is_approved: true } : s)));
    },
    []
  );

  const saveEditedStory = useCallback(
    async (storyId: string, fullText: string) => {
      await callEdgeFunction('conversation-save', {
        brd_id: brdId,
        role: 'user',
        content: fullText,
        section_key: 'story_edit',
      });
      await supabase
        .from('user_stories')
        .update({ full_text: fullText, action: fullText, is_edited: true })
        .eq('id', storyId);
      setStories(prev =>
        prev.map(s =>
          s.id === storyId ? { ...s, full_text: fullText, is_edited: true } : s
        )
      );
    },
    [brdId]
  );

  const removeStory = useCallback(
    async (storyId: string) => {
      await supabase.from('user_stories').delete().eq('id', storyId);
      setStories(prev => prev.filter(s => s.id !== storyId));
    },
    []
  );

  const addStory = useCallback(
    async (epicId: string, fullText: string, sortOrder: number) => {
      const { data, error } = await supabase
        .from('user_stories')
        .insert({
          brd_id: brdId,
          epic_id: epicId,
          full_text: fullText,
          // `action` is NOT NULL in the schema — mirror full_text (empty for a
          // blank new story). The user types the full sentence into full_text.
          action: fullText,
          is_approved: false,
          is_edited: false,
          sort_order: sortOrder,
        })
        .select()
        .single();
      if (!error && data) {
        setStories(prev => [...prev, data as import('../types/brd').UserStory]);
      }
      return { data, error };
    },
    [brdId]
  );

  const approveAllStories = useCallback(
    async (epicId: string) => {
      await supabase
        .from('user_stories')
        .update({ is_approved: true, approved_at: new Date().toISOString() })
        .eq('epic_id', epicId)
        .eq('is_approved', false);
      setStories(prev =>
        prev.map(s => (s.epic_id === epicId ? { ...s, is_approved: true } : s))
      );
    },
    []
  );

  return {
    sections,
    epics,
    stories,
    loading,
    load,
    approveSection,
    reopenSection,
    approveEpics,
    approveStory,
    saveEditedStory,
    removeStory,
    addStory,
    approveAllStories,
    setSections,
    setEpics,
    setStories,
  };
}
