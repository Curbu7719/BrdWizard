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
        .update({ full_text: fullText, is_approved: true, is_edited: true, approved_at: new Date().toISOString() })
        .eq('id', storyId);
      setStories(prev =>
        prev.map(s =>
          s.id === storyId ? { ...s, full_text: fullText, is_approved: true, is_edited: true } : s
        )
      );
    },
    [brdId]
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
    setSections,
    setEpics,
    setStories,
  };
}
