import { useState, useEffect, useRef, useCallback } from 'react';
import { AlertCircle, FileText, X, UploadCloud } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { Spinner } from '../shared/Spinner';
import { ChannelPicker } from './ChannelPicker';
import { INPUT_LIMITS, lengthError } from '../../lib/limits';
import { callEdgeFunction } from '../../lib/sse';
import { toast } from '../../hooks/useToast';
import type { ProductType, MobilityType, ChangeType } from '../../types/brd';
import { cn } from '../../lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────

interface ClassificationData {
  title: string;
  productType: ProductType;
  mobilityType: MobilityType;
  changeType: ChangeType;
  channels: string[];
  background: string;
  objective: string;
  sourceSummary?: string;
}

interface ClassificationFormProps {
  initialTitle?: string;
  onSubmit: (data: ClassificationData) => void;
  disabled?: boolean;
}

interface AnalyzeDocumentResponse {
  summary: string;
  warning?: string;
}

type RadioGroupProps<T extends string> = {
  name: string;
  legend: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
};

// ── Radio group ────────────────────────────────────────────────────────────

function RadioGroup<T extends string>({ name, legend, value, onChange, options, disabled }: RadioGroupProps<T>) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-foreground mb-1.5">{legend}</legend>
      <div className="flex flex-wrap gap-4">
        {options.map(opt => (
          <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              disabled={disabled}
              className="accent-primary"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ── Allowed file types ─────────────────────────────────────────────────────

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

function mimeLabel(mime: string): string {
  if (mime === 'application/pdf') return 'PDF';
  if (mime.includes('wordprocessingml')) return 'Word (.docx)';
  if (mime.includes('presentationml')) return 'PowerPoint (.pptx)';
  return mime;
}

// ── File-to-base64 helper ──────────────────────────────────────────────────

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:<mime>;base64," prefix — backend expects raw base64
      const base64 = result.slice(result.indexOf(',') + 1);
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// ── Main form ──────────────────────────────────────────────────────────────

export function ClassificationForm({ initialTitle = '', onSubmit, disabled }: ClassificationFormProps) {
  const [title, setTitle] = useState(initialTitle);
  const [productType, setProductType] = useState<ProductType>('postpaid');
  const [mobilityType, setMobilityType] = useState<MobilityType>('mobile');
  const [changeType, setChangeType] = useState<ChangeType>('new');
  const [channels, setChannels] = useState<string[]>([]);
  const [background, setBackground] = useState('');
  const [objective, setObjective] = useState('');

  // Validation errors
  const [titleError, setTitleError] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const [objectiveError, setObjectiveError] = useState<string | null>(null);

  // Document analysis state
  const [fileError, setFileError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [attachedFileName, setAttachedFileName] = useState<string | null>(null);
  const [sourceSummary, setSourceSummary] = useState<string | null>(null);
  const [analyzeWarning, setAnalyzeWarning] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialTitle) setTitle(initialTitle);
  }, [initialTitle]);

  // ── Document analysis ────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    setFileError(null);
    setAnalyzeWarning(null);

    // Client-side validation
    if (!ALLOWED_MIME.has(file.type)) {
      setFileError(`Unsupported file type "${mimeLabel(file.type) || file.type}". Please attach a PDF, Word (.docx), or PowerPoint (.pptx) file.`);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFileError(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum is 10 MB.`);
      return;
    }

    setAnalyzing(true);
    setAttachedFileName(file.name);

    let base64: string;
    try {
      base64 = await readFileAsBase64(file);
    } catch {
      setAnalyzing(false);
      setAttachedFileName(null);
      setFileError('Could not read the file. Please try again.');
      return;
    }

    const { data, error } = await callEdgeFunction<AnalyzeDocumentResponse>(
      'analyze-document',
      { filename: file.name, mime: file.type, data_base64: base64 }
    );

    setAnalyzing(false);

    if (error || !data) {
      setAttachedFileName(null);
      toast({
        variant: 'destructive',
        title: 'Document analysis failed',
        description: "Couldn't analyze the document — you can fill the fields manually.",
      });
      return;
    }

    // Store the summary as context for epic generation; do NOT touch any form fields.
    setSourceSummary(data.summary);
    if (data.warning) setAnalyzeWarning(data.warning);
  }, []);

  function clearAttachment() {
    setAttachedFileName(null);
    setSourceSummary(null);
    setAnalyzeWarning(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
  }

  // ── Form submit ──────────────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let hasError = false;

    if (!title.trim()) {
      setTitleError(true);
      hasError = true;
    } else {
      setTitleError(false);
    }

    const bgErr = lengthError(background, 'Background', INPUT_LIMITS.background);
    setBackgroundError(bgErr);
    if (bgErr) hasError = true;

    const objErr = lengthError(objective, 'Objective', INPUT_LIMITS.objective);
    setObjectiveError(objErr);
    if (objErr) hasError = true;

    if (hasError) return;

    onSubmit({
      title: title.trim(),
      productType,
      mobilityType,
      changeType,
      channels,
      background: background.trim(),
      objective: objective.trim(),
      ...(sourceSummary ? { sourceSummary } : {}),
    });
  }

  const isFormDisabled = disabled || analyzing;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      role="region"
      aria-label="BRD Project Setup Form"
      className="rounded-lg border border-border bg-secondary/50 p-4 space-y-4"
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* Title */}
        <div className="space-y-1">
          <Label htmlFor="brd-title">BRD Title</Label>
          <Input
            id="brd-title"
            placeholder="e.g. CRM Billing Revamp"
            value={title}
            onChange={e => { setTitle(e.target.value); setTitleError(false); }}
            disabled={isFormDisabled}
            aria-describedby={titleError ? 'title-error' : undefined}
          />
          {titleError && (
            <p id="title-error" className="text-xs text-destructive flex items-center gap-1 mt-1">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              Please enter a title
            </p>
          )}
        </div>

        {/* Document upload */}
        <div className="space-y-2">
          <Label>Source Document <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <p className="text-xs text-muted-foreground">
            Attach a PDF, Word, or PowerPoint file and we'll summarize it to guide epic generation. Background &amp; Objective are always yours to write.
          </p>

          {/* Drop zone — hidden when analysis is in progress or a file is already attached */}
          {!analyzing && !attachedFileName && (
            <div
              role="button"
              tabIndex={isFormDisabled ? -1 : 0}
              aria-label="Upload source document"
              onClick={() => !isFormDisabled && fileInputRef.current?.click()}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); !isFormDisabled && fileInputRef.current?.click(); } }}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={cn(
                'flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors',
                'cursor-pointer select-none',
                isDragOver
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border text-muted-foreground hover:border-accent hover:text-accent',
                isFormDisabled && 'pointer-events-none opacity-40'
              )}
            >
              <UploadCloud className="h-6 w-6" aria-hidden="true" />
              <span className="text-sm font-medium">Drag &amp; drop or click to attach</span>
              <span className="text-xs">PDF, Word (.docx), PowerPoint (.pptx) — max 10 MB</span>
            </div>
          )}

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="sr-only"
            aria-hidden="true"
            tabIndex={-1}
            onChange={handleInputChange}
          />

          {/* Analyzing state */}
          {analyzing && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
              <Spinner size="sm" label="Analyzing document" />
              <span>Analyzing document...</span>
            </div>
          )}

          {/* Attached file chip */}
          {!analyzing && attachedFileName && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="flex items-center gap-1.5 text-xs font-normal">
                  <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />
                  Summarized from {attachedFileName}
                  <button
                    type="button"
                    aria-label={`Remove ${attachedFileName}`}
                    onClick={clearAttachment}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-secondary-foreground/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
                {analyzeWarning && (
                  <Badge variant="warning" className="text-xs font-normal">
                    <AlertCircle className="h-3 w-3" aria-hidden="true" />
                    {analyzeWarning}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                This summary will guide epic generation. Background &amp; Objective are still yours to write.
              </p>
            </div>
          )}

          {/* Client-side file validation error */}
          {fileError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              {fileError}
            </p>
          )}
        </div>

        {/* Product Type */}
        <RadioGroup
          name="productType"
          legend="Product Type"
          value={productType}
          onChange={setProductType}
          disabled={isFormDisabled}
          options={[
            { value: 'prepaid', label: 'Prepaid' },
            { value: 'postpaid', label: 'Postpaid' },
            { value: 'both', label: 'Both' },
          ]}
        />

        {/* Mobility */}
        <RadioGroup
          name="mobilityType"
          legend="Mobility"
          value={mobilityType}
          onChange={setMobilityType}
          disabled={isFormDisabled}
          options={[
            { value: 'mobile', label: 'Mobile' },
            { value: 'fixed', label: 'Fixed' },
            { value: 'both', label: 'Both' },
          ]}
        />

        {/* Change Type */}
        <RadioGroup
          name="changeType"
          legend="Change Type"
          value={changeType}
          onChange={setChangeType}
          disabled={isFormDisabled}
          options={[
            { value: 'new', label: 'New Product or Journey' },
            { value: 'change', label: 'Change on Existing' },
          ]}
        />

        {/* Channels */}
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">Impacted Channels (select all that apply)</p>
          <ChannelPicker selected={channels} onChange={setChannels} disabled={isFormDisabled} />
        </div>

        {/* Background */}
        <div className="space-y-1">
          <Label htmlFor="brd-background">Background</Label>
          <p className="text-xs text-muted-foreground">Why is this project needed? What's the background?</p>
          <Textarea
            id="brd-background"
            placeholder="Describe the context and motivation for this project…"
            value={background}
            onChange={e => { setBackground(e.target.value); setBackgroundError(null); }}
            disabled={isFormDisabled}
            rows={4}
            maxLength={INPUT_LIMITS.background.max}
            aria-describedby={backgroundError ? 'background-error' : undefined}
          />
          <div className="flex items-center justify-between mt-1">
            {backgroundError ? (
              <p id="background-error" className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
                {backgroundError}
              </p>
            ) : <span />}
            <span className="text-xs text-muted-foreground">
              {background.length.toLocaleString()} / {INPUT_LIMITS.background.max.toLocaleString()}
              {background.trim().length > 0 && background.trim().length < INPUT_LIMITS.background.min
                ? ` (min ${INPUT_LIMITS.background.min})` : ''}
            </span>
          </div>
        </div>

        {/* Objective */}
        <div className="space-y-1">
          <Label htmlFor="brd-objective">Objective</Label>
          <p className="text-xs text-muted-foreground">What is to be done? Describe in detail.</p>
          <Textarea
            id="brd-objective"
            placeholder="Describe what needs to be built or changed and the desired outcome…"
            value={objective}
            onChange={e => { setObjective(e.target.value); setObjectiveError(null); }}
            disabled={isFormDisabled}
            rows={4}
            maxLength={INPUT_LIMITS.objective.max}
            aria-describedby={objectiveError ? 'objective-error' : undefined}
          />
          <div className="flex items-center justify-between mt-1">
            {objectiveError ? (
              <p id="objective-error" className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
                {objectiveError}
              </p>
            ) : <span />}
            <span className="text-xs text-muted-foreground">
              {objective.length.toLocaleString()} / {INPUT_LIMITS.objective.max.toLocaleString()}
              {objective.trim().length > 0 && objective.trim().length < INPUT_LIMITS.objective.min
                ? ` (min ${INPUT_LIMITS.objective.min})` : ''}
            </span>
          </div>
        </div>

        <Button type="submit" disabled={isFormDisabled} className="w-full">
          {analyzing
            ? <><Spinner size="sm" label="Analyzing" /> Analyzing document…</>
            : 'Start — Generate Epics'
          }
        </Button>
      </form>
    </div>
  );
}

export type { ClassificationData };
