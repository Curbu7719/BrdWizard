import { useState, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { ChannelPicker } from './ChannelPicker';
import { INPUT_LIMITS, lengthError } from '../../lib/limits';
import type { ProductType, MobilityType, ChangeType } from '../../types/brd';

interface ClassificationData {
  title: string;
  productType: ProductType;
  mobilityType: MobilityType;
  changeType: ChangeType;
  channels: string[];
  background: string;
  objective: string;
}

interface ClassificationFormProps {
  initialTitle?: string;
  onSubmit: (data: ClassificationData) => void;
  disabled?: boolean;
}

type RadioGroupProps<T extends string> = {
  name: string;
  legend: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
};

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

export function ClassificationForm({ initialTitle = '', onSubmit, disabled }: ClassificationFormProps) {
  const [title, setTitle] = useState(initialTitle);
  const [productType, setProductType] = useState<ProductType>('postpaid');
  const [mobilityType, setMobilityType] = useState<MobilityType>('mobile');
  const [changeType, setChangeType] = useState<ChangeType>('new');
  const [channels, setChannels] = useState<string[]>([]);
  const [background, setBackground] = useState('');
  const [objective, setObjective] = useState('');
  const [titleError, setTitleError] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const [objectiveError, setObjectiveError] = useState<string | null>(null);

  useEffect(() => {
    if (initialTitle) setTitle(initialTitle);
  }, [initialTitle]);

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
    });
  }

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
            disabled={disabled}
            aria-describedby={titleError ? 'title-error' : undefined}
          />
          {titleError && (
            <p id="title-error" className="text-xs text-destructive flex items-center gap-1 mt-1">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              Please enter a title
            </p>
          )}
        </div>

        {/* Product Type */}
        <RadioGroup
          name="productType"
          legend="Product Type"
          value={productType}
          onChange={setProductType}
          disabled={disabled}
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
          disabled={disabled}
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
          disabled={disabled}
          options={[
            { value: 'new', label: 'New Product or Journey' },
            { value: 'change', label: 'Change on Existing' },
          ]}
        />

        {/* Channels */}
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">Impacted Channels (select all that apply)</p>
          <ChannelPicker selected={channels} onChange={setChannels} disabled={disabled} />
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
            disabled={disabled}
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
            disabled={disabled}
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

        <Button type="submit" disabled={disabled} className="w-full">
          Start — Generate Epics
        </Button>
      </form>
    </div>
  );
}

export type { ClassificationData };
