/*
 * Client-side BRD → .docx builder.
 *
 * Generation runs in the browser (the `docx` package is browser-native and the
 * full BRD data is already loaded in the workspace). This avoids the Supabase
 * edge runtime, where docx's Packer fails. The audit-log row (brd_generations)
 * is still written server-side via the export-word function (logGeneration).
 *
 * Document structure mirrors docs/ARCHITECTURE.md §8:
 *   Title page → Expected Value → Background → Objective → Epics Overview
 *   (with per-epic user stories) → Reports → Notes.
 */
import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Packer,
} from 'docx';
import type { BrdDocument, BrdSection, Epic, UserStory, BrdWarning, WarningSource } from '../types/brd';
import { supabase } from './supabase';
import { logGeneration } from './sse';

const WARNING_SOURCE_LABEL: Record<WarningSource, string> = {
  kvkk: 'KVKK',
  data_privacy: 'Data Privacy',
  regulation: 'Regulation',
  maturity: 'Maturity',
};

function spacer(): Paragraph {
  return new Paragraph({ text: '' });
}

function titlePage(brd: BrdDocument): Paragraph[] {
  const date = new Date(brd.created_at).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return [
    new Paragraph({
      text: 'BUSINESS REQUIREMENTS DOCUMENT',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    }),
    spacer(),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: brd.title, bold: true, size: 32 })],
    }),
    spacer(),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Date: ${date}`, size: 24 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Business Line: ${brd.business_line}`, size: 24 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Classification: ${brd.product_type} | ${brd.mobility_type} | ${brd.change_type}`,
          size: 24,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Impacted Channels: ${brd.impacted_channels.join(', ') || 'None'}`,
          size: 24,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Status: ${brd.status.toUpperCase()}`, size: 24 })],
    }),
    spacer(),
    spacer(),
    new Paragraph({ pageBreakBefore: true, text: '' }),
  ];
}

/** Un-numbered free-text block with a heading (Expected Value, Notes, Reports). */
function textBlock(heading: string, content: string): Paragraph[] {
  const paragraphs: Paragraph[] = [
    new Paragraph({ text: heading, heading: HeadingLevel.HEADING_1 }),
    spacer(),
  ];
  for (const line of content.split('\n')) {
    paragraphs.push(new Paragraph({ children: [new TextRun({ text: line })] }));
  }
  paragraphs.push(spacer());
  return paragraphs;
}

function sectionBlock(section: BrdSection, number: number): Paragraph[] {
  const content = section.content_full ?? '(Section not yet completed)';
  const paragraphs: Paragraph[] = [
    new Paragraph({
      text: `${number}. ${section.section_title}`,
      heading: HeadingLevel.HEADING_1,
    }),
    spacer(),
  ];
  for (const line of content.split('\n')) {
    paragraphs.push(new Paragraph({ children: [new TextRun({ text: line })] }));
  }
  paragraphs.push(spacer());
  return paragraphs;
}

const FINDING_STATUS_LABEL: Record<BrdWarning['status'], string> = {
  acknowledged: 'Compliance Recommendation',
  open: 'Open Finding',
  rejected: 'Rejected Finding',
};

/** All findings targeting a story, rendered under it (grouped accepted → open →
 *  rejected) so the document reads in context. Accepted findings show the
 *  accepted recommendation; open/rejected show the issue plus any recommendation. */
function storyFindings(story: UserStory, warnings: BrdWarning[]): Paragraph[] {
  const items = warnings.filter(
    (w) => w.target_type === 'story' && w.target_story_id === story.id,
  );
  if (items.length === 0) return [];

  const order: BrdWarning['status'][] = ['acknowledged', 'open', 'rejected'];
  const sorted = [...items].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));

  const paragraphs: Paragraph[] = [];
  for (const w of sorted) {
    const source = WARNING_SOURCE_LABEL[w.source] ?? w.source;
    const statusLabel = FINDING_STATUS_LABEL[w.status] ?? w.status;
    const primary = w.status === 'acknowledged' ? (w.recommendation || w.message) : w.message;
    paragraphs.push(
      new Paragraph({
        indent: { left: 720 },
        children: [
          new TextRun({ text: `${statusLabel} [${source}]: `, bold: true, italics: true }),
          new TextRun({ text: primary }),
        ],
      }),
    );
    // For open/rejected, include the recommendation as a sub-line if present.
    if (w.status !== 'acknowledged' && w.recommendation) {
      paragraphs.push(
        new Paragraph({
          indent: { left: 1080 },
          children: [
            new TextRun({ text: 'Recommendation: ', italics: true }),
            new TextRun({ text: w.recommendation }),
          ],
        }),
      );
    }
  }
  return paragraphs;
}

function epicBlock(
  epic: Epic,
  stories: UserStory[],
  epicNumber: number,
  parentNumber: number,
  warnings: BrdWarning[],
): Paragraph[] {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      text: `${parentNumber}.${epicNumber} Epic: ${epic.title}`,
      heading: HeadingLevel.HEADING_2,
    }),
  ];

  if (epic.description) {
    paragraphs.push(new Paragraph({ children: [new TextRun({ text: epic.description })] }));
  }
  paragraphs.push(spacer());

  const epicStories = stories
    .filter((s) => s.epic_id === epic.id)
    .sort((a, b) => a.sort_order - b.sort_order);

  if (epicStories.length === 0) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: 'User stories not yet defined.', italics: true })],
      }),
    );
  } else {
    paragraphs.push(
      new Paragraph({ text: 'User Stories:', heading: HeadingLevel.HEADING_3 }),
    );
    for (const story of epicStories) {
      // full_text is multi-line: headline, then "Acceptance Criteria:" + "- " bullets.
      const lines = (story.full_text ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lines.length === 0) continue;

      // Headline as a top-level bullet.
      paragraphs.push(
        new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: lines[0] })] }),
      );

      // Remaining lines = acceptance criteria.
      for (const line of lines.slice(1)) {
        if (/^acceptance criteria:?$/i.test(line)) {
          paragraphs.push(
            new Paragraph({
              indent: { left: 720 },
              children: [new TextRun({ text: 'Acceptance Criteria:', italics: true })],
            }),
          );
        } else {
          paragraphs.push(
            new Paragraph({
              bullet: { level: 1 },
              children: [new TextRun({ text: line.replace(/^[-*]\s*/, '') })],
            }),
          );
        }
      }

      // All findings for this story (accepted / open / rejected), under its criteria.
      paragraphs.push(...storyFindings(story, warnings));
    }
  }

  paragraphs.push(spacer());
  return paragraphs;
}

/**
 * Review-findings appendix for a pre-filtered list of findings (e.g. open or
 * rejected). Accepted (acknowledged) story findings are not listed here — they
 * are rendered under their user story as "Compliance Recommendation" instead.
 */
function findingsBlock(
  items: BrdWarning[],
  heading: string,
  intro: string,
): Paragraph[] {
  if (items.length === 0) return [];

  const paragraphs: Paragraph[] = [
    new Paragraph({ text: heading, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun({ text: intro, italics: true })] }),
    spacer(),
  ];

  items.forEach((w, i) => {
    const label = WARNING_SOURCE_LABEL[w.source] ?? w.source;
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: `${i + 1}. [${label} · ${w.severity}] ${w.message}`, bold: true })],
      }),
    );
    if (w.recommendation) {
      paragraphs.push(
        new Paragraph({
          indent: { left: 360 },
          children: [
            new TextRun({ text: 'Recommendation: ', italics: true }),
            new TextRun({ text: w.recommendation }),
          ],
        }),
      );
    }
  });

  paragraphs.push(spacer());
  return paragraphs;
}

export interface BrdExportData {
  brd: BrdDocument;
  sections: BrdSection[];
  epics: Epic[];
  stories: UserStory[];
  warnings?: BrdWarning[];
}

/** Build the complete BRD .docx in the browser and return it as a Blob. */
export async function buildBrdDocxBlob({ brd, sections, epics, stories, warnings = [] }: BrdExportData): Promise<Blob> {
  const children: Paragraph[] = [];

  children.push(...titlePage(brd));

  // Expected Value (user-authored), if provided.
  if (brd.expected_value && brd.expected_value.trim()) {
    children.push(...textBlock('Expected Value', brd.expected_value.trim()));
  }

  // Sections: background (1), objective (2). Epics overview handled separately.
  const namedSections = sections
    .filter((s) => s.section_key !== 'epics_overview')
    .sort((a, b) => a.sort_order - b.sort_order);
  namedSections.forEach((section, idx) => {
    children.push(...sectionBlock(section, idx + 1));
  });

  // Epics overview section heading + content.
  const epicsSection = sections.find((s) => s.section_key === 'epics_overview');
  const epicsSectionNumber = namedSections.length + 1;
  children.push(
    new Paragraph({ text: `${epicsSectionNumber}. Epics Overview`, heading: HeadingLevel.HEADING_1 }),
    spacer(),
  );
  if (epicsSection?.content_full) {
    for (const line of epicsSection.content_full.split('\n')) {
      children.push(new Paragraph({ children: [new TextRun({ text: line })] }));
    }
    children.push(spacer());
  }

  // Per-epic sub-sections (ordered). Accepted findings render under their story.
  [...epics]
    .sort((a, b) => a.sort_order - b.sort_order)
    .forEach((epic, idx) => {
      children.push(...epicBlock(epic, stories, idx + 1, epicsSectionNumber, warnings));
    });

  // Reports, then Notes (user-authored), if provided.
  if (brd.reports && brd.reports.trim()) {
    children.push(...textBlock('Reports', brd.reports.trim()));
  }
  if (brd.notes && brd.notes.trim()) {
    children.push(...textBlock('Notes', brd.notes.trim()));
  }

  // Review findings appendix — only findings NOT tied to a user story (section /
  // BRD-level); story findings already appear under their story above. Split by
  // status: accepted, then open, then rejected.
  const nonStory = (status: BrdWarning['status']) =>
    warnings.filter((w) => w.status === status && w.target_type !== 'story');
  children.push(
    ...findingsBlock(
      nonStory('acknowledged'),
      'Accepted Compliance Recommendations',
      'The following recommendations were accepted (not tied to a specific user story).',
    ),
  );
  children.push(
    ...findingsBlock(
      nonStory('open'),
      'Open Findings',
      'The following review findings are unresolved (neither accepted nor rejected).',
    ),
  );
  children.push(
    ...findingsBlock(
      nonStory('rejected'),
      'Rejected Findings',
      'The following review findings were considered and rejected (not applied to the BRD).',
    ),
  );

  const doc = new Document({
    creator: 'BRD Wizard',
    title: brd.title,
    description: `Business Requirements Document — ${brd.title}`,
    sections: [{ children }],
  });

  return Packer.toBlob(doc);
}

/** Trigger a browser download of a Blob with the given filename. */
export function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(href);
}

/**
 * High-level export: build the .docx in the browser, download it, and record the
 * audit-log row. Sections/epics/stories may be passed in (workspace already has
 * them) or are fetched from the DB (e.g. the dashboard card). Throws on a
 * build/fetch failure so the caller can surface a toast; the audit log is
 * non-fatal (a failure there is logged, not thrown).
 */
export async function exportBrdToWord(
  brd: BrdDocument,
  opts?: { sections?: BrdSection[]; epics?: Epic[]; stories?: UserStory[]; warnings?: BrdWarning[]; score?: number },
): Promise<void> {
  let sections = opts?.sections;
  let epics = opts?.epics;
  let stories = opts?.stories;
  let warnings = opts?.warnings;

  if (!sections || !epics || !stories || !warnings) {
    const [s, e, st, w] = await Promise.all([
      supabase.from('brd_sections').select('*').eq('brd_id', brd.id).order('sort_order', { ascending: true }),
      supabase.from('epics').select('*').eq('brd_id', brd.id).order('sort_order', { ascending: true }),
      supabase.from('user_stories').select('*').eq('brd_id', brd.id).order('sort_order', { ascending: true }),
      supabase.from('brd_warnings').select('*').eq('brd_id', brd.id),
    ]);
    sections = sections ?? ((s.data ?? []) as BrdSection[]);
    epics = epics ?? ((e.data ?? []) as Epic[]);
    stories = stories ?? ((st.data ?? []) as UserStory[]);
    warnings = warnings ?? ((w.data ?? []) as BrdWarning[]);
  }

  const blob = await buildBrdDocxBlob({ brd, sections, epics, stories, warnings });
  const safeName = brd.title.replace(/[^a-zA-Z0-9\-_ ]/g, '').trim() || 'BRD';
  downloadBlob(blob, `BRD-${safeName.replace(/\s+/g, '-')}.docx`);

  // Audit log — non-fatal; the user already has the file.
  const { error } = await logGeneration(brd.id, opts?.score);
  if (error) console.warn('[exportBrdToWord] generation log failed:', error);
}
