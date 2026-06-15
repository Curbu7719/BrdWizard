/**
 * Output parser — FLOW-INTEGRATION.md §3.2
 *
 * Scans the completed assistant text for machine-parseable XML blocks and
 * returns whatever structured content is present. The parser is intentionally
 * tolerant: it extracts the first matching block it finds and returns early.
 * Blocks may be absent; the caller should check `result.type === 'none'`.
 *
 * XML contracts (FLOW-INTEGRATION.md §2):
 *   <section_draft key="background|objective|epics_overview">prose</section_draft>
 *   <epics><epic title="..." sort_order="N">desc</epic>...</epics>
 *   <stories epic_id="uuid"><story persona="..." channel="..." sort_order="N">text</story>...</stories>
 *
 * Called ONLY after the stream is fully complete — never on partial chunks.
 */

export interface EpicItem {
  title: string;
  description: string;
  sort_order: number;
}

export interface StoryItem {
  persona: string;
  channel: string;
  full_text: string;
  action: string;
  channel_hint: string;
  sort_order: number;
}

export type ParseResultType = 'section_draft' | 'epics' | 'stories' | 'none';

export interface ParseResult {
  type: ParseResultType;
  /** Present when type === 'section_draft' */
  sectionKey?: string;
  /** Present when type === 'section_draft' */
  sectionContent?: string;
  /** Present when type === 'epics' */
  epics?: EpicItem[];
  /** Present when type === 'stories' */
  stories?: StoryItem[];
  /** Present when type === 'stories' — the UUID from the <stories epic_id="..."> attribute */
  epicId?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract a named XML attribute value from a tag string.
 * Returns undefined if the attribute is absent.
 */
function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : undefined;
}

/**
 * Extract the action clause from a user story sentence.
 *
 * Extracts the substring between "I should be able to" and "on the"
 * (case-insensitive). Falls back to the full text if the pattern is absent.
 */
function extractAction(fullText: string): string {
  const match = fullText.match(/I should be able to (.+?) on the/i);
  return match ? match[1].trim() : fullText;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse the agent's completed response text for structured XML output blocks.
 *
 * Checks in order: section_draft → epics → stories.
 * Returns `{ type: 'none' }` when no recognised block is found.
 */
export function parseAgentOutput(text: string): ParseResult {
  // ── 1. Section draft ──────────────────────────────────────────────────────
  //    <section_draft key="background">...prose...</section_draft>
  const sectionMatch = text.match(
    /<section_draft\s+key="([\w_]+)">([\s\S]*?)<\/section_draft>/,
  );
  if (sectionMatch) {
    return {
      type: 'section_draft',
      sectionKey: sectionMatch[1],
      sectionContent: sectionMatch[2].trim(),
    };
  }

  // ── 2. Epic proposal ──────────────────────────────────────────────────────
  //    <epics><epic title="..." sort_order="N">desc</epic>...</epics>
  const epicsBlock = text.match(/<epics>([\s\S]*?)<\/epics>/);
  if (epicsBlock) {
    // Extract each <epic ...>...</epic> element (attributes may be in any order).
    const epicTagRe = /<epic([^>]*)>([^<]*)<\/epic>/g;
    const items: EpicItem[] = [];
    let m: RegExpExecArray | null;
    while ((m = epicTagRe.exec(epicsBlock[1])) !== null) {
      const tagAttrs = m[1];
      const description = m[2].trim();
      const title = attr(tagAttrs, 'title');
      const sortOrderStr = attr(tagAttrs, 'sort_order');
      if (title !== undefined && sortOrderStr !== undefined) {
        items.push({
          title,
          description,
          sort_order: parseInt(sortOrderStr, 10),
        });
      }
    }

    if (items.length > 0) {
      return { type: 'epics', epics: items };
    }
  }

  // ── 3. User stories ────────────────────────────────────────────────────────
  //    <stories epic_id="uuid"><story persona="..." channel="..." sort_order="N">text</story></stories>
  const storiesBlock = text.match(
    /<stories\s+epic_id="([^"]+)">([\s\S]*?)<\/stories>/,
  );
  if (storiesBlock) {
    const epicId = storiesBlock[1];
    // Allow nested child tags inside <story> (headline + criteria), so use a
    // non-greedy [\s\S] body matcher rather than [^<]*.
    const storyTagRe = /<story([^>]*)>([\s\S]*?)<\/story>/g;
    const stories: StoryItem[] = [];
    let sm: RegExpExecArray | null;
    while ((sm = storyTagRe.exec(storiesBlock[2])) !== null) {
      const tagAttrs = sm[1];
      const inner = sm[2];

      const persona = attr(tagAttrs, 'persona') ?? '';
      const channel = attr(tagAttrs, 'channel') ?? '';
      const sortOrderStr = attr(tagAttrs, 'sort_order') ?? '0';

      // Preferred structured form: <headline>…</headline> + <criteria><c>…</c>…</criteria>.
      // Assemble full_text = headline + "Acceptance Criteria:" + "- " bullets.
      const headlineM = inner.match(/<headline>([\s\S]*?)<\/headline>/);
      let fullText: string;
      if (headlineM) {
        const headline = headlineM[1].trim();
        const criteria: string[] = [];
        const critBlock = inner.match(/<criteria>([\s\S]*?)<\/criteria>/);
        if (critBlock) {
          const cRe = /<c>([\s\S]*?)<\/c>/g;
          let cm: RegExpExecArray | null;
          while ((cm = cRe.exec(critBlock[1])) !== null) {
            const t = cm[1].trim();
            if (t) criteria.push(t);
          }
        }
        fullText = headline +
          (criteria.length > 0
            ? '\nAcceptance Criteria:\n' + criteria.map((c) => `- ${c}`).join('\n')
            : '');
      } else {
        // Fallback: flat text (older/looser form) — strip any stray tags.
        fullText = inner.replace(/<[^>]+>/g, '').trim();
      }

      if (!fullText) continue;

      stories.push({
        persona,
        channel,
        sort_order: parseInt(sortOrderStr, 10),
        full_text: fullText,
        action: extractAction(fullText),
        channel_hint: channel,
      });
    }

    // Return even when stories array is empty — the block was present; the
    // caller can decide what to do with zero stories.
    return { type: 'stories', epicId, stories };
  }

  return { type: 'none' };
}
