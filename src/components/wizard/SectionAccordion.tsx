import { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle, Clock, RefreshCw, Save, X, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { EpicBlock } from './EpicBlock';
import { WarningList } from './WarningList';
import type { BrdSection, Epic, UserStory, SectionStatus, BrdWarning } from '../../types/brd';

// Sections that use inline text editing instead of chat-driven revision.
const INLINE_EDIT_SECTIONS = new Set(['background', 'objective']);

interface SectionAccordionProps {
  section: BrdSection;
  epics?: Epic[];
  stories?: UserStory[];
  onRevise?: (sectionKey: string) => void;
  /** Called when the user saves an inline edit (background/objective only). */
  onInlineSave?: (sectionKey: string, content: string) => Promise<void>;
  /** Called when the user edits a user story in place (epics section). */
  onEditStory?: (storyId: string, text: string) => void | Promise<void>;
  /** All review findings for this BRD (filtered per section/story here). */
  warnings?: BrdWarning[];
  onAcknowledgeWarning?: (id: string) => void;
  onRejectWarning?: (id: string) => void;
}

function SectionStatusIcon({ status }: { status: SectionStatus }) {
  if (status === 'approved') return <CheckCircle className="h-4 w-4 text-success" aria-label="Approved" />;
  if (status === 'in_progress') return <Clock className="h-4 w-4 text-accent" aria-label="In progress" />;
  return <span className="h-4 w-4 rounded-full border-2 border-muted-foreground/40 inline-block" aria-label="Pending" />;
}

export function SectionAccordion({ section, epics = [], stories = [], onRevise, onInlineSave, onEditStory, warnings = [], onAcknowledgeWarning, onRejectWarning }: SectionAccordionProps) {
  const [open, setOpen] = useState(section.status === 'approved' || section.status === 'in_progress');
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(section.content_full ?? '');
  const [saving, setSaving] = useState(false);

  const isEpics = section.section_key === 'epics_overview';
  const isInlineEdit = INLINE_EDIT_SECTIONS.has(section.section_key);

  // Findings attached to this section directly.
  const sectionWarnings = warnings.filter(
    w => w.target_type === 'section' && w.target_section_key === section.section_key,
  );
  // For the epics section, story findings also surface within it.
  const storyWarningCount = isEpics
    ? warnings.filter(w => w.target_type === 'story' && w.status === 'open').length
    : 0;
  const openBadgeCount =
    sectionWarnings.filter(w => w.status === 'open').length + storyWarningCount;

  async function handleSave() {
    if (!onInlineSave || !editText.trim()) return;
    setSaving(true);
    await onInlineSave(section.section_key, editText.trim());
    setSaving(false);
    setEditing(false);
  }

  function handleCancelEdit() {
    setEditText(section.content_full ?? '');
    setEditing(false);
  }

  function handleReviseClick() {
    if (isInlineEdit) {
      // Inline edit: open the textarea editor in place.
      setEditText(section.content_full ?? '');
      setEditing(true);
    } else if (onRevise) {
      onRevise(section.section_key);
    }
  }

  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]',
        section.status === 'approved' && 'border-success/30 bg-success/5',
        section.status === 'in_progress' && 'border-accent/30 ring-1 ring-accent/20',
        section.status === 'pending' && 'border-border bg-background opacity-60',
      )}
    >
      {/* Header */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-black/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
        aria-controls={`section-${section.id}`}
      >
        <SectionStatusIcon status={section.status} />
        <span className="flex-1 text-sm font-semibold text-foreground">{section.section_title}</span>
        {openBadgeCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 text-warning px-2 py-0.5 text-xs font-medium" title="Open review findings">
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            {openBadgeCount}
          </span>
        )}
        {open
          ? <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          : <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        }
      </button>

      {/* Content */}
      {open && (
        <div id={`section-${section.id}`} className="px-4 pb-4 space-y-3">
          {sectionWarnings.length > 0 && onAcknowledgeWarning && (
            <WarningList warnings={sectionWarnings} onAcknowledge={onAcknowledgeWarning} onReject={onRejectWarning} />
          )}
          {!isEpics && !editing && section.content_full && (
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{section.content_full}</p>
          )}

          {!isEpics && !editing && !section.content_full && section.status === 'pending' && (
            <p className="text-xs text-muted-foreground italic">Not yet started.</p>
          )}

          {/* Inline editor (background / objective only) */}
          {!isEpics && editing && (
            <div className="space-y-2">
              <Textarea
                value={editText}
                onChange={e => setEditText(e.target.value)}
                rows={6}
                disabled={saving}
                className="text-sm"
                aria-label={`Edit ${section.section_title}`}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving || !editText.trim()}
                >
                  <Save className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCancelEdit}
                  disabled={saving}
                >
                  <X className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Epics section */}
          {isEpics && (
            <div className="space-y-2">
              {epics.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No epics yet.</p>
              ) : (
                epics.map(epic => (
                  <EpicBlock
                    key={epic.id}
                    epic={epic}
                    stories={stories.filter(s => s.epic_id === epic.id)}
                    onEditStory={onEditStory}
                    warnings={warnings}
                    onAcknowledgeWarning={onAcknowledgeWarning}
                    onRejectWarning={onRejectWarning}
                  />
                ))
              )}
            </div>
          )}

          {/* Revise button — shown for approved non-epics sections when not editing */}
          {section.status === 'approved' && !isEpics && !editing && (isInlineEdit ? onInlineSave : onRevise) && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleReviseClick}
              className="mt-1"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              Revise
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
