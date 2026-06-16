/**
 * /analyze-document — source-document summarizer for BRD context enrichment.
 *
 * Accepts a PDF, DOCX, or PPTX as base64, reads it once in-memory,
 * asks the LLM to produce a consolidated reference summary that captures
 * key context, scope, goals, and constraints — suitable for informing
 * epic and user-story generation later in the BRD flow.
 *
 * The raw file is NEVER stored — it is processed here and discarded.
 * The caller (frontend) persists the returned summary to brd_documents.source_summary,
 * from which context-builder.ts injects it into the session context during epic/story phases.
 *
 * The document is NOT used to pre-fill any BRD fields. Background and Objective
 * are always authored manually by the user.
 *
 * Method: POST
 * Auth:   required (JWT)
 *
 * Request body (JSON):
 *   {
 *     "filename": "brief.pdf",         // used for extension-based MIME validation
 *     "mime":     "application/pdf",   // must match one of the allowed MIME types
 *     "data_base64": "<base64string>"  // raw file bytes encoded as base64
 *   }
 *
 * Response (JSON, 200):
 *   {
 *     "summary": "string (≤4000 chars)",
 *     "warning": "string"              // optional — present when text was truncated
 *   }
 *
 * Error responses (JSON):
 *   400 — invalid body / unsupported type / file too large
 *   401 — missing or invalid JWT
 *   500 — LLM or extraction failure
 */

import { corsPreflightResponse, withCors } from '../_shared/cors.ts';
import { verifyAuth, getServiceClient } from '../_shared/supabase-client.ts';
import { createLLMProvider } from '../_shared/llm/index.ts';
import { getSettings } from '../_shared/settings.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed decoded file size in bytes (10 MB). */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Maximum characters of extracted text sent to the LLM (≈60k). */
const MAX_TEXT_CHARS = 60_000;

/** Maximum characters for the returned summary. */
const MAX_SUMMARY_CHARS = 4000;

/** Allowed MIME types mapped to a canonical kind. */
const ALLOWED_MIMES: Record<string, 'pdf' | 'docx' | 'pptx'> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  // Some browsers/OSes send these alternative types for Office documents.
  'application/msword': 'docx',
  'application/vnd.ms-powerpoint': 'pptx',
};

/** Allowed file extensions mapped to canonical kind — used as a secondary check. */
const ALLOWED_EXTENSIONS: Record<string, 'pdf' | 'docx' | 'pptx'> = {
  pdf: 'pdf',
  docx: 'docx',
  pptx: 'pptx',
};

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

interface AnalyzeResponse {
  summary: string;
  warning?: string;
}

// ---------------------------------------------------------------------------
// File-type detection helpers
// ---------------------------------------------------------------------------

/**
 * Determine the canonical file kind from MIME type and filename extension.
 * Returns null if neither is acceptable.
 */
function detectKind(
  mime: string,
  filename: string,
): 'pdf' | 'docx' | 'pptx' | null {
  // Prefer MIME type — it is authoritative when the browser sets it correctly.
  const byMime = ALLOWED_MIMES[mime.toLowerCase()];
  if (byMime) return byMime;

  // Fall back to extension for cases where the MIME is generic (octet-stream, etc.).
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return ALLOWED_EXTENSIONS[ext] ?? null;
}

// ---------------------------------------------------------------------------
// Content extraction — DOCX and PPTX
// ---------------------------------------------------------------------------

/**
 * Extract plain text from a DOCX file.
 *
 * Strategy: unzip the OOXML package with JSZip, read word/document.xml,
 * strip all XML tags, collapse whitespace to single spaces.
 *
 * JSZip is loaded via esm.sh — no runtime file I/O, Deno-compatible.
 */
async function extractDocx(bytes: Uint8Array): Promise<string> {
  // deno-lint-ignore no-explicit-any
  const JSZip = (await import('https://esm.sh/jszip@3.10.1')).default as any;
  const zip = await JSZip.loadAsync(bytes);

  const documentXmlFile = zip.file('word/document.xml');
  if (!documentXmlFile) {
    throw new Error('Invalid DOCX: word/document.xml not found in archive');
  }

  const xml: string = await documentXmlFile.async('string');

  // Strip all XML tags and decode common XML entities.
  const text = xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x[0-9A-Fa-f]+;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

/**
 * Extract plain text from a PPTX file.
 *
 * Strategy: unzip, read all ppt/slides/slide*.xml in slide order (sorted
 * lexicographically — slide1.xml, slide2.xml, ...), strip XML tags, join
 * with double newlines so slides are visually separated.
 */
async function extractPptx(bytes: Uint8Array): Promise<string> {
  // deno-lint-ignore no-explicit-any
  const JSZip = (await import('https://esm.sh/jszip@3.10.1')).default as any;
  const zip = await JSZip.loadAsync(bytes);

  // Collect slide filenames and sort them by slide number.
  // JSZip exposes files as an object keyed by path.
  const slideNames: string[] = Object.keys(zip.files as Record<string, unknown>)
    .filter((name: string) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a: string, b: string) => {
      // Extract numeric portion for correct ordering (slide2 < slide10).
      const numA = parseInt(a.replace(/[^0-9]/g, ''), 10);
      const numB = parseInt(b.replace(/[^0-9]/g, ''), 10);
      return numA - numB;
    });

  if (slideNames.length === 0) {
    throw new Error('Invalid PPTX: no slide XML files found in archive');
  }

  const slideTexts: string[] = [];

  for (const slideName of slideNames) {
    const slideFile = zip.file(slideName);
    if (!slideFile) continue;

    const xml: string = await slideFile.async('string');
    const text = xml
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#x[0-9A-Fa-f]+;/g, ' ')
      .replace(/&#\d+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (text) slideTexts.push(text);
  }

  return slideTexts.join('\n\n');
}

// ---------------------------------------------------------------------------
// LLM summarization
// ---------------------------------------------------------------------------

/**
 * Build the instruction string sent to the LLM alongside the document content.
 * The model is asked to produce a single consolidated reference summary.
 */
function buildInstructions(): string {
  return `You are a business analyst assistant. Read the provided document and produce a single, consolidated **reference summary** for an analyst who will later write epics and user stories for a Business Requirements Document (BRD).

The summary must capture:
- The overall scope and purpose of the initiative
- Key business context, drivers, and constraints
- Any stakeholders, systems, or channels mentioned
- Goals or outcomes described in the document
- Anything else an analyst would need to propose meaningful epics

Rules:
- Write in clear, professional prose. No bullet-point lists unless the source material is structured that way.
- Do NOT split the output into Background / Objective sections — produce one unified summary.
- Do NOT suggest classification values (product type, mobility type, channels, etc.).
- Maximum ${MAX_SUMMARY_CHARS} characters. Be concise but complete.
- Output ONLY the summary text — no preamble, no labels, no XML tags.`;
}

/**
 * Truncate text to MAX_TEXT_CHARS if needed.
 * Returns the (possibly truncated) string and a boolean indicating truncation.
 */
function truncateText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TEXT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_TEXT_CHARS), truncated: true };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

async function handlePost(req: Request): Promise<Response> {
  // Auth check — verifyAuth throws a Response on failure.
  try {
    await verifyAuth(req);
  } catch (errResponse) {
    return errResponse as Response;
  }

  // Parse request body.
  let body: { filename?: unknown; mime?: unknown; data_base64?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  const { filename, mime, data_base64 } = body;

  if (
    typeof filename !== 'string' || !filename ||
    typeof mime !== 'string' || !mime ||
    typeof data_base64 !== 'string' || !data_base64
  ) {
    return new Response(
      JSON.stringify({ error: 'filename, mime, and data_base64 are required string fields' }),
      { status: 400, headers: withCors({ 'Content-Type': 'application/json' }) },
    );
  }

  // Detect file kind.
  const kind = detectKind(mime, filename);
  if (!kind) {
    return new Response(
      JSON.stringify({
        error: 'Unsupported file type. Accepted: PDF (.pdf), Word (.docx), PowerPoint (.pptx)',
      }),
      { status: 400, headers: withCors({ 'Content-Type': 'application/json' }) },
    );
  }

  // Decode base64 and size-check.
  let fileBytes: Uint8Array;
  try {
    // atob is available in Deno and modern browsers.
    const binaryStr = atob(data_base64);
    fileBytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      fileBytes[i] = binaryStr.charCodeAt(i);
    }
  } catch {
    return new Response(
      JSON.stringify({ error: 'data_base64 is not valid base64' }),
      { status: 400, headers: withCors({ 'Content-Type': 'application/json' }) },
    );
  }

  if (fileBytes.length > MAX_FILE_BYTES) {
    const sizeMb = (fileBytes.length / 1024 / 1024).toFixed(1);
    return new Response(
      JSON.stringify({
        error: `File too large (${sizeMb} MB). Maximum allowed size is 10 MB.`,
      }),
      { status: 400, headers: withCors({ 'Content-Type': 'application/json' }) },
    );
  }

  // Route to the appropriate extraction path. Use the admin-selected model
  // (cached settings lookup; falls back to the default if unavailable).
  const settings = await getSettings(getServiceClient());
  const llm = createLLMProvider(settings.ai_model_id);
  const instructions = buildInstructions();
  let warning: string | undefined;
  let rawLLMResponse: string;

  try {
    if (kind === 'pdf') {
      // PDF: use native LLM document block — no text extraction needed.
      // The LLM reads the PDF directly (far more accurate than text stripping).
      const result = await llm.summarizeDocument(
        { kind: 'pdf', base64: data_base64 },
        instructions,
      );
      rawLLMResponse = result.text;
    } else {
      // DOCX / PPTX: unzip and extract plain text first, then summarize.
      let extractedText: string;

      if (kind === 'docx') {
        extractedText = await extractDocx(fileBytes);
      } else {
        extractedText = await extractPptx(fileBytes);
      }

      const { text: truncated, truncated: wasTruncated } = truncateText(extractedText);

      if (wasTruncated) {
        warning = `Document text was truncated to ${MAX_TEXT_CHARS.toLocaleString()} characters for analysis. The summary covers the first portion of the document.`;
      }

      const result = await llm.summarizeDocument(
        { kind: 'text', text: truncated },
        instructions,
      );
      rawLLMResponse = result.text;
    }
  } catch (err) {
    console.error('[analyze-document] extraction/LLM error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: `Document analysis failed: ${message}` }),
      { status: 500, headers: withCors({ 'Content-Type': 'application/json' }) },
    );
  }

  const summary = rawLLMResponse.trim().slice(0, MAX_SUMMARY_CHARS);

  if (!summary) {
    console.error('[analyze-document] empty LLM output');
    return new Response(
      JSON.stringify({ error: 'Model returned an empty summary' }),
      { status: 500, headers: withCors({ 'Content-Type': 'application/json' }) },
    );
  }

  const response: AnalyzeResponse = { summary };

  if (warning) {
    response.warning = warning;
  }

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: withCors({ 'Content-Type': 'application/json' }),
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return corsPreflightResponse();

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: withCors({ 'Content-Type': 'application/json' }),
    });
  }

  return handlePost(req);
});
