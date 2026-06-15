/**
 * /export-word — ARCHITECTURE.md §3.1, §8
 *
 * Assembles the complete BRD from the database and returns a .docx binary.
 * Server-side generation keeps the API key and full BRD data server-side.
 * Uses the `docx` npm package via npm: specifier.
 *
 * Method: POST
 * Auth: required (JWT)
 *
 * Request body:
 *   { "brd_id": "uuid" }
 *
 * Response:
 *   application/vnd.openxmlformats-officedocument.wordprocessingml.document
 *   Content-Disposition: attachment; filename="BRD-<title>.docx"
 *
 * Document structure (ARCHITECTURE.md §8):
 *   Title page: BRD title, date, owner, classification
 *   1. Background
 *   2. Objective
 *   3. Epics Overview
 *      3.x Epic: <title>
 *          User Stories: ...
 */

import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Packer,
} from 'npm:docx@8';

import { corsPreflightResponse, withCors } from '../_shared/cors.ts';
import { verifyAuth, getServiceClient } from '../_shared/supabase-client.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BrdDocRow {
  id: string;
  title: string;
  owner_id: string;
  business_line: string;
  product_type: string;
  mobility_type: string;
  change_type: string;
  impacted_channels: string[];
  status: string;
  created_at: string;
}

interface SectionRow {
  section_key: string;
  section_title: string;
  sort_order: number;
  content_full: string | null;
  status: string;
}

interface EpicRow {
  id: string;
  title: string;
  description: string | null;
  sort_order: number;
  is_approved: boolean;
}

interface StoryRow {
  epic_id: string;
  full_text: string;
  sort_order: number;
  is_approved: boolean;
}

// ---------------------------------------------------------------------------
// Document builders
// ---------------------------------------------------------------------------

function spacer(): Paragraph {
  return new Paragraph({ text: '' });
}

function titlePage(brd: BrdDocRow): Paragraph[] {
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
      children: [
        new TextRun({ text: brd.title, bold: true, size: 32 }),
      ],
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
    new Paragraph({
      pageBreakBefore: true,
      text: '',
    }),
  ];
}

function sectionBlock(section: SectionRow, number: number): Paragraph[] {
  const content = section.content_full ?? '(Section not yet completed)';
  const paragraphs: Paragraph[] = [
    new Paragraph({
      text: `${number}. ${section.section_title}`,
      heading: HeadingLevel.HEADING_1,
    }),
    spacer(),
  ];

  // Split content on newlines to preserve paragraph structure.
  for (const line of content.split('\n')) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: line })],
      }),
    );
  }

  paragraphs.push(spacer());
  return paragraphs;
}

function epicBlock(
  epic: EpicRow,
  stories: StoryRow[],
  epicNumber: number,
  parentNumber: number,
): Paragraph[] {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      text: `${parentNumber}.${epicNumber} Epic: ${epic.title}`,
      heading: HeadingLevel.HEADING_2,
    }),
  ];

  if (epic.description) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: epic.description })],
      }),
    );
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
      new Paragraph({
        text: 'User Stories:',
        heading: HeadingLevel.HEADING_3,
      }),
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
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: lines[0] })],
        }),
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
    }
  }

  paragraphs.push(spacer());
  return paragraphs;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return corsPreflightResponse();

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  let userId: string;
  try {
    const user = await verifyAuth(req);
    userId = user.id;
  } catch (errResponse) {
    return errResponse as Response;
  }

  let body: { brd_id: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  const { brd_id } = body;

  if (!brd_id) {
    return new Response(JSON.stringify({ error: 'brd_id is required' }), {
      status: 400,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  const db = getServiceClient();

  // Load BRD (verify ownership or public access).
  const { data: brdRow, error: brdError } = await db
    .from('brd_documents')
    .select('*')
    .eq('id', brd_id)
    .or(`owner_id.eq.${userId},visibility.eq.public`)
    .single();

  if (brdError || !brdRow) {
    return new Response(JSON.stringify({ error: 'BRD not found or access denied' }), {
      status: 404,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  const brd = brdRow as BrdDocRow;

  // Load all sections.
  const { data: sectionsRaw } = await db
    .from('brd_sections')
    .select('section_key, section_title, sort_order, content_full, status')
    .eq('brd_id', brd_id)
    .order('sort_order', { ascending: true });

  const sections = (sectionsRaw ?? []) as SectionRow[];

  // Load all epics.
  const { data: epicsRaw } = await db
    .from('epics')
    .select('id, title, description, sort_order, is_approved')
    .eq('brd_id', brd_id)
    .order('sort_order', { ascending: true });

  const epics = (epicsRaw ?? []) as EpicRow[];

  // Load all user stories.
  const { data: storiesRaw } = await db
    .from('user_stories')
    .select('epic_id, full_text, sort_order, is_approved')
    .eq('brd_id', brd_id)
    .order('sort_order', { ascending: true });

  const stories = (storiesRaw ?? []) as StoryRow[];

  // ---------------------------------------------------------------------------
  // Build document tree.
  // ---------------------------------------------------------------------------

  const children: Paragraph[] = [];

  // Title page.
  children.push(...titlePage(brd));

  // Sections: background (1), objective (2).
  const namedSections = sections.filter(
    (s) => s.section_key !== 'epics_overview',
  );
  namedSections.forEach((section, idx) => {
    children.push(...sectionBlock(section, idx + 1));
  });

  // Epics overview section heading.
  const epicsSection = sections.find((s) => s.section_key === 'epics_overview');
  const epicsSectionNumber = namedSections.length + 1;

  children.push(
    new Paragraph({
      text: `${epicsSectionNumber}. Epics Overview`,
      heading: HeadingLevel.HEADING_1,
    }),
    spacer(),
  );

  if (epicsSection?.content_full) {
    for (const line of epicsSection.content_full.split('\n')) {
      children.push(new Paragraph({ children: [new TextRun({ text: line })] }));
    }
    children.push(spacer());
  }

  // Per-epic sub-sections.
  epics.forEach((epic, idx) => {
    children.push(
      ...epicBlock(epic, stories, idx + 1, epicsSectionNumber),
    );
  });

  // Build the Document.
  const doc = new Document({
    creator: 'BRD Wizard',
    title: brd.title,
    description: `Business Requirements Document — ${brd.title}`,
    sections: [
      {
        children,
      },
    ],
  });

  // Serialise to buffer.
  let buffer: Uint8Array;
  try {
    buffer = await Packer.toBuffer(doc);
  } catch (err) {
    console.error('[export-word] Packer error:', err);
    return new Response(JSON.stringify({ error: 'Failed to generate document' }), {
      status: 500,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  // Sanitise filename.
  const safeName = brd.title.replace(/[^a-zA-Z0-9\-_ ]/g, '').trim() || 'BRD';

  return new Response(buffer, {
    status: 200,
    headers: withCors({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="BRD-${safeName}.docx"`,
      'Content-Length': String(buffer.byteLength),
    }),
  });
});
