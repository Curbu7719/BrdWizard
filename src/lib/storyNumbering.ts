/*
 * Document numbering for epics and user stories.
 *
 * Both the exported .docx and the workspace UI label stories with the SAME
 * hierarchical number — <epics-section>.<epic>.<story> (e.g. 3.1.2) — so review
 * findings that cross-reference a story by its document number resolve to the
 * same item everywhere. The edge function (supabase/.../brd-review.ts) reproduces
 * this scheme for the reviewer input; keep the two in sync.
 *
 * Numbers are index-based on sort_order: the epics section number is the count of
 * named sections + 1, then epics and their stories are 1-based by sort_order.
 */
import type { BrdSection, Epic, UserStory } from '../types/brd';

export interface ReviewNumbers {
  /** story id → "3.1.2" */
  storyNumbers: Map<string, string>;
  /** epic id → "3.1" */
  epicNumbers: Map<string, string>;
  /** The epics-overview section's document number (e.g. 3). */
  epicsSectionNumber: number;
}

export function buildReviewNumbers(
  sections: BrdSection[],
  epics: Epic[],
  stories: UserStory[],
): ReviewNumbers {
  const namedCount = sections.filter((s) => s.section_key !== 'epics_overview').length;
  const epicsSectionNumber = namedCount + 1;

  const storyNumbers = new Map<string, string>();
  const epicNumbers = new Map<string, string>();

  [...epics]
    .sort((a, b) => a.sort_order - b.sort_order)
    .forEach((epic, ei) => {
      const epicNo = `${epicsSectionNumber}.${ei + 1}`;
      epicNumbers.set(epic.id, epicNo);
      stories
        .filter((s) => s.epic_id === epic.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .forEach((story, si) => {
          storyNumbers.set(story.id, `${epicNo}.${si + 1}`);
        });
    });

  return { storyNumbers, epicNumbers, epicsSectionNumber };
}
