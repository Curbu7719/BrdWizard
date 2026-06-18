import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useBrdDocument, useBrdActions } from '../hooks/useBrd';
import { useChat } from '../hooks/useChat';
import { useSections } from '../hooks/useSection';
import { useReview } from '../hooks/useReview';
import { supabase } from '../lib/supabase';
import { callEdgeFunction } from '../lib/sse';
import { ChatPanel } from '../components/wizard/ChatPanel';
import { ApprovedPanel } from '../components/wizard/ApprovedPanel';
import { WorkspaceHeader } from '../components/wizard/WorkspaceHeader';
import { ScoreDialog } from '../components/wizard/ScoreDialog';
import { computeBrdScore, type BrdScore } from '../lib/brdScore';
import { Spinner } from '../components/shared/Spinner';
import { exportBrdToWord } from '../lib/exportDocx';
import { toast } from '../hooks/useToast';
import type { ContextWarningLevel } from '../hooks/useChat';
import type { ClassificationData } from '../components/wizard/ClassificationForm';

export default function BrdWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { brd, loading: brdLoading, refetch: refetchBrd } = useBrdDocument(id!);
  const { updateBrd } = useBrdActions();
  const {
    sections,
    epics,
    stories,
    loading: sectionsLoading,
    load: loadSections,
    approveSection,
    approveEpics,
    saveEditedStory,
    removeStory,
    addStory,
    approveAllStories,
    reopenSection,
  } = useSections(id!);

  const {
    warnings,
    stage: reviewStage,
    busy: reviewBusy,
    submitForReview,
    acknowledge: acknowledgeWarning,
  } = useReview(id!, brd?.review_stage ?? 'none');

  const [contextPct, setContextPct] = useState<number | undefined>(undefined);
  const [generating, setGenerating] = useState(false);
  const [scoreDialog, setScoreDialog] = useState<{ open: boolean; score: BrdScore | null }>({
    open: false,
    score: null,
  });

  // ── Classification ──────────────────────────────────────────────────────────
  // Shown once on first entry when the BRD has never been classified.
  // showClassification is derived after brd + messages load.
  const [classificationSubmitted, setClassificationSubmitted] = useState(false);

  // ── Active section (local source of truth) ───────────────────────────────────
  // We own the active section in local state rather than reading the async
  // `brd.active_section`, so transitions take effect SYNCHRONOUSLY for the next
  // send() (the continuation turn). Seeded once from the DB on first load (for
  // resume); afterwards the transition handlers drive it.
  const [activeSection, setActiveSection] = useState<string>('background');
  const seededRef = useRef(false);
  useEffect(() => {
    if (brd && !seededRef.current) {
      seededRef.current = true;
      if (brd.active_section) setActiveSection(brd.active_section);
    }
  }, [brd]);

  // ── Approval UI state ───────────────────────────────────────────────────────
  /** section_key for which a section draft is pending user approval */
  const [pendingApprovalSectionKey, setPendingApprovalSectionKey] = useState<string | null>(null);
  /** Whether to show the EpicProposalCard */
  const [showEpicProposal, setShowEpicProposal] = useState(false);
  /** epic_id for which stories are pending per-story approval */
  const [pendingStoryEpicId, setPendingStoryEpicId] = useState<string | null>(null);
  /** epic_id whose stories were just approved — agent may ask clarifications before we continue */
  const [epicAwaitingContinue, setEpicAwaitingContinue] = useState<string | null>(null);

  // ── SSE event callbacks ─────────────────────────────────────────────────────

  const handleSectionReady = useCallback((sectionKey: string) => {
    void loadSections();
    setPendingApprovalSectionKey(sectionKey);
  }, [loadSections]);

  const handleEpicsProposed = useCallback(() => {
    void loadSections();
    setShowEpicProposal(true);
  }, [loadSections]);

  const handleStoriesReady = useCallback((epicId: string) => {
    void loadSections();
    setPendingStoryEpicId(epicId);
    // Starting review for a new epic — clear any previous continue gate.
    setEpicAwaitingContinue(null);
  }, [loadSections]);

  // ── Context event ───────────────────────────────────────────────────────────

  const handleContextEvent = useCallback((level: ContextWarningLevel, pct?: number) => {
    if (pct !== undefined) setContextPct(pct);
    if (level === 'checkpoint' || level === 'handoff') {
      void loadSections();
      void refetchBrd();
    }
  }, [loadSections, refetchBrd]);

  // ── useChat ─────────────────────────────────────────────────────────────────

  const { messages, streaming, contextLevel, send } = useChat({
    brdId: id!,
    // Local activeSection is the source of truth (see above). Defaults to
    // 'background' so the very first message has a valid section_key.
    sectionKey: activeSection,
    onContextEvent: handleContextEvent,
    onSectionReady: handleSectionReady,
    onEpicsProposed: handleEpicsProposed,
    onStoriesReady: handleStoriesReady,
  });

  // ── Classification guard (§6.1) ─────────────────────────────────────────────
  // Show the form if the BRD has never been classified AND no conversation
  // turns exist yet (messages.length === 0 after history load).
  const showClassification =
    !classificationSubmitted &&
    brd?.product_type === 'unknown' &&
    messages.length === 0;

  // ── Initial section load ────────────────────────────────────────────────────

  useEffect(() => {
    if (id) void loadSections();
  }, [id, loadSections]);

  // ── Send / actions ──────────────────────────────────────────────────────────

  async function handleSend(text: string) {
    await send(text);
    void loadSections();
    void refetchBrd();
  }

  // ── Classification submit (§6.2) ────────────────────────────────────────────

  async function handleClassificationSubmit(data: ClassificationData) {
    if (!brd) return;
    setClassificationSubmitted(true);

    const now = new Date().toISOString();

    // 1. PATCH brd_documents with classification fields; jump straight to epics.
    const { error: docError } = await supabase
      .from('brd_documents')
      .update({
        title: data.title,
        product_type: data.productType,
        mobility_type: data.mobilityType,
        change_type: data.changeType,
        impacted_channels: data.channels,
        active_section: 'epics_overview',
        updated_at: now,
        ...(data.expectedValue ? { expected_value: data.expectedValue } : {}),
        ...(data.sourceSummary ? { source_summary: data.sourceSummary } : {}),
      })
      .eq('id', brd.id);

    if (docError) {
      toast({ title: 'Failed to save project setup', variant: 'destructive' });
      setClassificationSubmitted(false);
      return;
    }

    // 2. Upsert Background and Objective as pre-approved sections (no LLM call).
    const bgSummary = data.background.length > 140
      ? data.background.slice(0, 137) + '...'
      : data.background;
    const objSummary = data.objective.length > 140
      ? data.objective.slice(0, 137) + '...'
      : data.objective;

    const { error: sectionsError } = await supabase
      .from('brd_sections')
      .upsert(
        [
          {
            brd_id: brd.id,
            section_key: 'background',
            section_title: 'Background',
            sort_order: 0,
            content_full: data.background,
            summary_line: bgSummary,
            status: 'approved',
            approved_at: now,
          },
          {
            brd_id: brd.id,
            section_key: 'objective',
            section_title: 'Objective',
            sort_order: 1,
            content_full: data.objective,
            summary_line: objSummary,
            status: 'approved',
            approved_at: now,
          },
        ],
        { onConflict: 'brd_id,section_key' }
      );

    if (sectionsError) {
      toast({ title: 'Failed to save background/objective', variant: 'destructive' });
      setClassificationSubmitted(false);
      return;
    }

    // 3. Advance local active section to epics.
    setActiveSection('epics_overview');

    // 4. Load sections + refetch brd so the right panel shows bg/obj immediately.
    void loadSections();
    void refetchBrd();

    // 5. Kick off epic proposal — '[approved]' in epics_overview context tells
    //    the backend to review Background + Objective and propose epics.
    await send('[approved]', 'epics_overview');
    void loadSections();
    void refetchBrd();
  }

  // ── Section approval (§5.1) ─────────────────────────────────────────────────

  async function handleSectionApprove(sectionKey: string) {
    // Fetch the parsed content from DB (we don't store it in SSE payload).
    const { data: sectionRow } = await supabase
      .from('brd_sections')
      .select('content_full')
      .eq('brd_id', id!)
      .eq('section_key', sectionKey)
      .single();

    const content = sectionRow?.content_full ?? '';
    const { error, nextSection } = await approveSection(sectionKey, content);
    if (error) {
      toast({ title: 'Failed to approve section', description: error, variant: 'destructive' });
      return;
    }
    setPendingApprovalSectionKey(null);
    const next = nextSection ?? sectionKey;
    setActiveSection(next);
    void loadSections();
    void refetchBrd();
    // Synthetic continuation so agent moves to the next section (sent to `next`).
    await send('[approved]', next);
    void loadSections();
    void refetchBrd();
  }

  // ── Epic approval (§5.2) ────────────────────────────────────────────────────

  async function handleApproveAllEpics() {
    // Read fresh epic rows from DB rather than trusting possibly-stale state —
    // this is why approval previously didn't persist (empty/stale id list).
    const { data: freshEpics } = await supabase
      .from('epics')
      .select('id, title, description')
      .eq('brd_id', id!)
      .order('sort_order', { ascending: true });

    const epicIds = (freshEpics ?? []).map(e => e.id);
    if (epicIds.length === 0) return;

    // Step 1 — mark epics approved in DB.
    await approveEpics(epicIds);

    // Step 2 — approve the epics_overview section.
    const approvedContent = (freshEpics ?? [])
      .map((e, i) => `${i + 1}. **${e.title}** — ${e.description ?? ''}`)
      .join('\n');

    await callEdgeFunction('section-checkpoint', {
      brd_id: id!,
      section_key: 'epics_overview',
      approved_content: approvedContent,
      trigger: 'user_approval',
    });

    setShowEpicProposal(false);
    // Per-epic story phases are frontend-driven — advance to the first epic.
    const next = 'epic_1_stories';
    setActiveSection(next);
    await supabase
      .from('brd_documents')
      .update({ active_section: next, updated_at: new Date().toISOString() })
      .eq('id', id!);
    void loadSections();
    void refetchBrd();

    // Step 3 — continuation turn so agent begins story generation for Epic 1.
    await send('[approved: all epics]', next);
    void loadSections();
    void refetchBrd();
  }

  // ── Step 1: Approve stories (§5.3) ────────────────────────────────────────
  // Marks stories approved in DB and lets the agent ask clarifying questions.
  // Does NOT advance active_section — that happens in handleContinueNextEpic.

  async function handleApproveAllStories() {
    if (!pendingStoryEpicId || !brd) return;

    await approveAllStories(pendingStoryEpicId);

    const approvedEpicId = pendingStoryEpicId;
    // Hide the EpicStoriesReview card; show the "Continue" action card instead.
    setPendingStoryEpicId(null);
    setEpicAwaitingContinue(approvedEpicId);

    void loadSections();

    // Let the agent know stories were approved so it can ask clarifications.
    await send('[stories-approved]', activeSection);
    void loadSections();
    void refetchBrd();
  }

  // ── Step 2: Continue to next epic (§5.3) ──────────────────────────────────
  // Advances active_section after the user finishes clarification chat.

  async function handleContinueNextEpic() {
    if (!brd) return;

    const epicMatch = activeSection.match(/^epic_(\d+)_stories$/);
    if (!epicMatch) return;

    const currentEpicIndex = parseInt(epicMatch[1], 10); // 1-based

    const { data: allEpics } = await supabase
      .from('epics')
      .select('id, sort_order')
      .eq('brd_id', id!)
      .order('sort_order', { ascending: true });

    const totalEpics = allEpics?.length ?? 0;
    const nextEpicIndex = currentEpicIndex + 1;

    setEpicAwaitingContinue(null);

    if (nextEpicIndex <= totalEpics) {
      const nextSection = `epic_${nextEpicIndex}_stories`;
      setActiveSection(nextSection);
      await supabase
        .from('brd_documents')
        .update({ active_section: nextSection, updated_at: new Date().toISOString() })
        .eq('id', id!);

      void refetchBrd();
      await send('[ready: next epic]', nextSection);
    } else {
      await supabase
        .from('brd_documents')
        .update({ status: 'complete', active_section: null, updated_at: new Date().toISOString() })
        .eq('id', id!);
      void refetchBrd();
      toast({ title: 'BRD Complete! All sections and stories are approved.' });
    }

    void loadSections();
  }

  async function handleEditStory(storyId: string, text: string) {
    await saveEditedStory(storyId, text);
    void loadSections();
  }

  async function handleRemoveStory(storyId: string) {
    await removeStory(storyId);
    void loadSections();
  }

  async function handleAddStory() {
    if (!pendingStoryEpicId || !id) return;
    const currentStories = stories.filter(s => s.epic_id === pendingStoryEpicId);
    const nextSortOrder = currentStories.length > 0
      ? Math.max(...currentStories.map(s => s.sort_order)) + 1
      : 0;
    const { error } = await addStory(pendingStoryEpicId, '', nextSortOrder);
    if (error) {
      toast({ title: 'Could not add story', description: error.message, variant: 'destructive' });
      return;
    }
    void loadSections();
  }

  // ── Other handlers ──────────────────────────────────────────────────────────

  async function handleSaveBrdField(field: 'expected_value' | 'notes' | 'reports', value: string) {
    if (!brd) return;
    const { error } = await supabase
      .from('brd_documents')
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq('id', brd.id);
    if (error) toast({ title: 'Failed to save', variant: 'destructive' });
    else void refetchBrd();
  }

  async function handleSubmitReview() {
    const { error } = await submitForReview();
    if (error) {
      toast({ title: 'Could not submit for review', description: error, variant: 'destructive' });
      return;
    }
    void refetchBrd();
  }

  async function handleTitleChange(newTitle: string) {
    if (!brd) return;
    const { error } = await updateBrd(brd.id, { title: newTitle });
    if (error) toast({ title: 'Failed to rename BRD', variant: 'destructive' });
    else void refetchBrd();
  }

  async function handleRevise(sectionKey: string) {
    const { error } = await reopenSection(sectionKey);
    if (error) toast({ title: 'Failed to reopen section', description: error, variant: 'destructive' });
    else void loadSections();
  }

  // Inline save for background/objective — updates content directly in DB,
  // no chat interview needed. Called from SectionAccordion for those two keys.
  async function handleInlineSaveSection(sectionKey: string, content: string) {
    if (!id) return;
    const summary = content.length > 140 ? content.slice(0, 137) + '...' : content;
    const { error } = await supabase
      .from('brd_sections')
      .update({
        content_full: content,
        summary_line: summary,
        updated_at: new Date().toISOString(),
      })
      .eq('brd_id', id)
      .eq('section_key', sectionKey);

    if (error) {
      toast({ title: 'Failed to save changes', variant: 'destructive' });
    } else {
      void loadSections();
    }
  }

  async function doExport(force = false) {
    if (!brd) return;

    // Always compute a readiness score on Generate and surface it for confirmation.
    // Pressing Generate again after closing gaps recomputes a fresh score.
    if (!force) {
      const score = computeBrdScore({ brd, sections, epics, stories, warnings });
      setScoreDialog({ open: true, score });
      return;
    }

    setGenerating(true);
    try {
      // Build the .docx in the browser (the edge runtime can't run docx's Packer).
      // Workspace already has the data loaded, so pass it in (no refetch).
      await exportBrdToWord(brd, { sections, epics, stories, score: scoreDialog.score?.score });
      toast({ title: 'BRD exported successfully', variant: 'default' });
    } catch (err) {
      toast({ title: 'Export failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (brdLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!brd) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-muted-foreground">
        <p>BRD not found.</p>
        <button
          onClick={() => navigate('/')}
          className="text-primary underline text-sm"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  // Derive the epic and its title for EpicStoriesReview rendering.
  const pendingEpic = pendingStoryEpicId
    ? epics.find(e => e.id === pendingStoryEpicId) ?? null
    : null;
  // undefined when no epic pending — signals MessageList not to show the batch review.
  const pendingStories = pendingStoryEpicId
    ? stories.filter(s => s.epic_id === pendingStoryEpicId && !s.is_approved)
    : undefined;

  // Determine whether the current epic is the last one, used for "Finish BRD" vs "Continue to next epic" label.
  const epicIndexMatch = activeSection.match(/^epic_(\d+)_stories$/);
  const currentEpicIndex = epicIndexMatch ? parseInt(epicIndexMatch[1], 10) : 0;
  const isLastEpic = currentEpicIndex > 0 && currentEpicIndex >= epics.length;

  // ── Draft-section button ─────────────────────────────────────────────────
  // Show only for canonical interview sections, never during streaming, and
  // never when another approval UI is already visible.
  // Only the prose sections get a draft button — epics_overview expects an
  // <epics> proposal block, not a <section_draft>, so [draft-section] doesn't
  // apply there.
  // Background and Objective are now collected via the setup form (no AI interview),
  // so the draft-section button is never needed for any section.
  const DRAFT_SECTION_LABELS: Record<string, string> = {};
  const draftButtonLabel =
    !streaming &&
    !showClassification &&
    pendingApprovalSectionKey === null &&
    !showEpicProposal &&
    pendingStoryEpicId === null
      ? (DRAFT_SECTION_LABELS[activeSection] ?? null)
      : null;

  async function handleDraftSection() {
    await send('[draft-section]', activeSection);
  }

  return (
    <>
      <WorkspaceHeader
        brd={brd}
        onTitleChange={handleTitleChange}
        reviewStage={reviewStage}
        canSubmitReview={sections.length > 0 && sections.every(s => s.status === 'approved')}
        reviewBusy={reviewBusy}
        onSubmitReview={handleSubmitReview}
      />

      {/* Small screen warning */}
      <div className="hidden max-lg:flex fixed inset-0 z-50 items-center justify-center bg-background/95 backdrop-blur text-center p-8">
        <div className="space-y-2">
          <p className="text-base font-medium text-foreground">BRD editing works best on a larger screen.</p>
          <p className="text-sm text-muted-foreground">Please use a desktop or laptop at 1280px or wider.</p>
        </div>
      </div>

      {/* Two-pane layout */}
      <div className="flex h-screen pt-14 overflow-hidden">
        {/* Left — Chat */}
        <div className="flex flex-col overflow-hidden" style={{ width: 'calc(55% - 0.5px)' }}>
          <ChatPanel
            messages={messages}
            streaming={streaming}
            contextLevel={contextLevel}
            contextPct={contextPct}
            showClassification={showClassification}
            classificationInitialTitle={brd.title === 'Untitled BRD' ? '' : brd.title}
            classificationDisabled={streaming}
            onClassificationSubmit={handleClassificationSubmit}
            pendingApprovalSectionKey={pendingApprovalSectionKey}
            onSectionApprove={handleSectionApprove}
            showEpicProposal={showEpicProposal}
            proposedEpics={epics}
            onApproveAllEpics={handleApproveAllEpics}
            onEditEpicsInChat={() => setShowEpicProposal(false)}
            pendingStories={pendingStories}
            pendingEpicTitle={pendingEpic?.title ?? ''}
            onEditStory={handleEditStory}
            onRemoveStory={handleRemoveStory}
            onAddStory={handleAddStory}
            onApproveAllStories={handleApproveAllStories}
            awaitingContinue={epicAwaitingContinue !== null && !streaming}
            isLastEpic={isLastEpic}
            onContinueNextEpic={handleContinueNextEpic}
            onSend={handleSend}
            onRetry={() => {
              const lastUser = [...messages].reverse().find(m => m.role === 'user');
              if (lastUser) void handleSend(lastUser.content);
            }}
            draftButtonLabel={draftButtonLabel ?? undefined}
            onDraftSection={draftButtonLabel ? handleDraftSection : undefined}
          />
        </div>

        {/* Divider */}
        <div className="w-px bg-border shrink-0" />

        {/* Right — Approved sections */}
        <div className="flex flex-col overflow-hidden flex-1">
          <ApprovedPanel
            sections={sections}
            epics={epics}
            stories={stories}
            loading={sectionsLoading}
            onRevise={handleRevise}
            onInlineSaveSection={handleInlineSaveSection}
            onEditStory={handleEditStory}
            expectedValue={brd.expected_value ?? ''}
            notes={brd.notes ?? ''}
            reports={brd.reports ?? ''}
            onSaveField={handleSaveBrdField}
            warnings={warnings}
            reviewStage={reviewStage}
            reviewBusy={reviewBusy}
            canSubmitReview={sections.length > 0 && sections.every(s => s.status === 'approved')}
            onSubmitReview={handleSubmitReview}
            onAcknowledgeWarning={acknowledgeWarning}
            onGenerateBrd={() => doExport(false)}
            generating={generating}
          />
        </div>
      </div>

      {/* BRD readiness score + generate confirmation */}
      <ScoreDialog
        open={scoreDialog.open}
        onOpenChange={(open) => setScoreDialog(prev => ({ ...prev, open }))}
        score={scoreDialog.score}
        generating={generating}
        onGenerateAnyway={async () => {
          setScoreDialog(prev => ({ ...prev, open: false }));
          await doExport(true);
        }}
      />
    </>
  );
}
