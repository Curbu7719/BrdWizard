import { SectionAccordion } from './SectionAccordion';
import { BrdInputCard } from './BrdInputCard';
import { ReviewPanel } from './ReviewPanel';
import { Button } from '../ui/button';
import { Spinner } from '../shared/Spinner';
import { cn } from '../../lib/utils';
import type { BrdSection, Epic, UserStory, BrdWarning, ReviewStage } from '../../types/brd';

interface ApprovedPanelProps {
  sections: BrdSection[];
  epics: Epic[];
  stories: UserStory[];
  loading: boolean;
  onRevise: (sectionKey: string) => void;
  /** For background/objective sections: save edited content directly to DB. */
  onInlineSaveSection: (sectionKey: string, content: string) => Promise<void>;
  /** Edit an approved user story in place. */
  onEditStory: (storyId: string, text: string) => void | Promise<void>;
  /** User-authored expected business value. */
  expectedValue: string;
  /** User-authored free-form notes. */
  notes: string;
  /** User-authored reporting requirements. */
  reports: string;
  /** Persist a user-authored field (expected_value | notes | reports). */
  onSaveField: (field: 'expected_value' | 'notes' | 'reports', value: string) => void | Promise<void>;
  /** Review pipeline state. */
  warnings: BrdWarning[];
  reviewStage: ReviewStage;
  reviewBusy: boolean;
  canSubmitReview: boolean;
  onSubmitReview: () => void;
  onAcknowledgeWarning: (id: string) => void;
  onRejectWarning?: (id: string) => void;
  onGenerateBrd: () => void;
  generating: boolean;
  /** Live readiness score (0-100), recomputed by the parent. */
  score?: number | null;
}

export function ApprovedPanel({
  sections,
  epics,
  stories,
  loading,
  onRevise,
  onInlineSaveSection,
  onEditStory,
  expectedValue,
  notes,
  reports,
  onSaveField,
  warnings,
  reviewStage,
  reviewBusy,
  canSubmitReview,
  onSubmitReview,
  onAcknowledgeWarning,
  onRejectWarning,
  onGenerateBrd,
  generating,
  score,
}: ApprovedPanelProps) {
  const generalWarnings = warnings.filter(w => w.target_type === 'brd');
  const openCount = warnings.filter(w => w.status === 'open').length;

  // Right-panel order: Background, Objective, [Expected Value], Epics, User
  // Stories, [Notes], [Reports]. Expected Value sits right after Objective, so we
  // split the section list into the intro sections and everything after.
  const INTRO_KEYS = ['background', 'objective'];
  const introSections = sections.filter(s => INTRO_KEYS.includes(s.section_key));
  const restSections = sections.filter(s => !INTRO_KEYS.includes(s.section_key));
  const renderSection = (section: BrdSection) => (
    <SectionAccordion
      key={section.id}
      section={section}
      epics={epics}
      stories={stories}
      onRevise={onRevise}
      onInlineSave={onInlineSaveSection}
      onEditStory={onEditStory}
      warnings={warnings}
      onAcknowledgeWarning={onAcknowledgeWarning}
      onRejectWarning={onRejectWarning}
    />
  );

  return (
    <div className="flex flex-col h-full bg-secondary/50 overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 shrink-0">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Approved Sections
        </h2>
      </div>

      {/* Section list */}
      <div className="flex-1 overflow-y-auto px-6 space-y-3 pb-4">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Spinner size="md" />
          </div>
        )}

        {!loading && sections.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-muted-foreground">
            <p>Approved content will appear here</p>
            <p>as you work through the sections.</p>
          </div>
        )}

        {/* Background, Objective */}
        {!loading && introSections.map(renderSection)}

        {/* Expected Value — directly after Objective */}
        {!loading && (
          <BrdInputCard
            label="Expected Value"
            placeholder="What business value or outcome do you expect from this BRD?"
            value={expectedValue}
            onSave={text => onSaveField('expected_value', text)}
          />
        )}

        {/* Epics, User Stories (and any later sections) */}
        {!loading && restSections.map(renderSection)}

        {/* Compliance & maturity review */}
        {!loading && (
          <ReviewPanel
            stage={reviewStage}
            busy={reviewBusy}
            canSubmit={canSubmitReview}
            openCount={openCount}
            totalCount={warnings.length}
            generalWarnings={generalWarnings}
            onSubmit={onSubmitReview}
            onAcknowledge={onAcknowledgeWarning}
            onReject={onRejectWarning}
          />
        )}

        {/* User-authored inputs — Notes, then Reports (last) */}
        {!loading && (
          <div className="space-y-3 pt-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Your Inputs
            </h2>
            <BrdInputCard
              label="Notes"
              placeholder="Any notes you want to attach to this BRD…"
              value={notes}
              onSave={text => onSaveField('notes', text)}
            />
            <BrdInputCard
              label="Reports"
              placeholder="Reporting requirements — what reports are needed, fields, frequency, recipients…"
              value={reports}
              onSave={text => onSaveField('reports', text)}
            />
          </div>
        )}
      </div>

      {/* Footer — live readiness score + Generate BRD */}
      <div className="shrink-0 border-t border-border bg-background/80 px-6 py-4 space-y-2">
        {typeof score === 'number' && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Readiness score</span>
            <span className={cn('font-semibold tabular-nums', score >= 70 ? 'text-success' : 'text-warning')}>
              {score} / 100
            </span>
          </div>
        )}
        <Button
          className="w-full"
          onClick={onGenerateBrd}
          disabled={generating}
        >
          {generating ? (
            <>
              <Spinner size="sm" />
              Generating…
            </>
          ) : (
            'Generate BRD'
          )}
        </Button>
      </div>
    </div>
  );
}
