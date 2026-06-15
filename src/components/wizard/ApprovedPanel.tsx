import { SectionAccordion } from './SectionAccordion';
import { Button } from '../ui/button';
import { Spinner } from '../shared/Spinner';
import type { BrdSection, Epic, UserStory } from '../../types/brd';

interface ApprovedPanelProps {
  sections: BrdSection[];
  epics: Epic[];
  stories: UserStory[];
  loading: boolean;
  onRevise: (sectionKey: string) => void;
  /** For background/objective sections: save edited content directly to DB. */
  onInlineSaveSection: (sectionKey: string, content: string) => Promise<void>;
  onGenerateBrd: () => void;
  generating: boolean;
}

export function ApprovedPanel({
  sections,
  epics,
  stories,
  loading,
  onRevise,
  onInlineSaveSection,
  onGenerateBrd,
  generating,
}: ApprovedPanelProps) {
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

        {!loading && sections.map(section => (
          <SectionAccordion
            key={section.id}
            section={section}
            epics={epics}
            stories={stories}
            onRevise={onRevise}
            onInlineSave={onInlineSaveSection}
          />
        ))}
      </div>

      {/* Footer — Generate BRD */}
      <div className="shrink-0 border-t border-border bg-background/80 px-6 py-4">
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
