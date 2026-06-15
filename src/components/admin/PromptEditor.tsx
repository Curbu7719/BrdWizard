import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { Spinner } from '../shared/Spinner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import { toast } from '../../hooks/useToast';
import { callEdgeFunctionGet, callEdgeFunctionPatch, callEdgeFunction } from '../../lib/sse';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PromptVersion {
  id: string;
  prompt_key: string;
  version: number;
  content: string;
  is_active: boolean;
  is_default: boolean;
  label: string | null;
  created_at: string;
}

interface PromptsResponse {
  prompts: Record<string, PromptVersion[]>;
}

type PromptKey = 'platform_layer' | 'agent_skill' | 'channel_mapping';

const PROMPT_KEYS: Array<{ key: PromptKey; label: string; description: string }> = [
  {
    key: 'platform_layer',
    label: 'Platform Layer',
    description: 'Platform rules, output format, guardrails, stop conditions, and the structured-output XML contract.',
  },
  {
    key: 'agent_skill',
    label: 'Agent Skill',
    description: 'BA role, BRD process, interview style, user story format, and examples. Must contain the {{CHANNEL_MAPPING}} placeholder.',
  },
  {
    key: 'channel_mapping',
    label: 'Channel Mapping',
    description: 'Channel-to-domain mapping rules injected via the {{CHANNEL_MAPPING}} placeholder in Agent Skill.',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function activeVersion(versions: PromptVersion[]): PromptVersion | undefined {
  return versions.find(v => v.is_active);
}

function defaultVersion(versions: PromptVersion[]): PromptVersion | undefined {
  return versions.find(v => v.is_default);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PromptEditor() {
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState<Record<string, PromptVersion[]>>({});
  const [selectedKey, setSelectedKey] = useState<PromptKey>('platform_layer');

  // Editing state
  const [editing, setEditing] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [draftLabel, setDraftLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState<string | null>(null); // version id

  // Preview state
  const [previewContent, setPreviewContent] = useState<string | null>(null);

  // Confirm activate dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    versionId: string;
    versionLabel: string;
  }>({ open: false, versionId: '', versionLabel: '' });

  useEffect(() => {
    void loadPrompts();
  }, []);

  async function loadPrompts() {
    setLoading(true);
    const { data, error } = await callEdgeFunctionGet<PromptsResponse>('settings-admin');
    setLoading(false);

    if (error) {
      toast({
        title: 'Failed to load prompts',
        description: error,
        variant: 'destructive',
      });
      return;
    }

    if (data?.prompts) {
      setVersions(data.prompts);
    }
  }

  const currentVersions: PromptVersion[] = versions[selectedKey] ?? [];
  const active = activeVersion(currentVersions);

  function startEditing() {
    setDraftContent(active?.content ?? '');
    setDraftLabel('');
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setDraftContent('');
    setDraftLabel('');
  }

  function validateDraft(): string | null {
    if (!draftContent.trim()) return 'Prompt content cannot be empty.';
    if (draftContent.length > 100_000) return 'Prompt content exceeds 100,000 character limit.';
    if (draftContent.includes('\0')) return 'Prompt content contains invalid characters.';
    if (selectedKey === 'agent_skill' && !draftContent.includes('{{CHANNEL_MAPPING}}')) {
      return 'Agent Skill prompt must contain the {{CHANNEL_MAPPING}} placeholder. The backend will reject activation without it.';
    }
    return null;
  }

  async function handleSaveAndActivate() {
    const validationErr = validateDraft();
    if (validationErr) {
      toast({ title: 'Validation error', description: validationErr, variant: 'destructive' });
      return;
    }

    setConfirmDialog({
      open: true,
      versionId: '',
      versionLabel: draftLabel || 'New version',
    });
  }

  async function confirmSaveAndActivate() {
    setConfirmDialog(prev => ({ ...prev, open: false }));
    setSaving(true);

    // Step 1: POST to create a draft
    const { data: created, error: createErr } = await callEdgeFunction<{ id: string }>(
      'settings-admin/prompt',
      {
        prompt_key: selectedKey,
        content: draftContent,
        label: draftLabel.trim() || null,
      }
    );

    if (createErr || !created?.id) {
      setSaving(false);
      toast({
        title: 'Failed to save prompt',
        description: createErr ?? 'Unknown error',
        variant: 'destructive',
      });
      return;
    }

    // Step 2: PATCH to activate
    const { error: activateErr } = await callEdgeFunctionPatch<unknown>(
      `settings-admin/prompt/${created.id}/activate`,
      {}
    );

    setSaving(false);

    if (activateErr) {
      toast({
        title: 'Prompt saved but activation failed',
        description: activateErr,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Prompt saved and activated',
        description: 'Changes will take effect within ~60 seconds.',
      });
      setEditing(false);
      setDraftContent('');
      setDraftLabel('');
      void loadPrompts();
    }
  }

  async function handleActivateVersion(versionId: string, versionLabel: string) {
    setConfirmDialog({ open: true, versionId, versionLabel });
  }

  async function confirmActivateVersion() {
    const { versionId } = confirmDialog;
    setConfirmDialog(prev => ({ ...prev, open: false }));
    setActivating(versionId);

    const { error } = await callEdgeFunctionPatch<unknown>(
      `settings-admin/prompt/${versionId}/activate`,
      {}
    );

    setActivating(null);

    if (error) {
      toast({
        title: 'Activation failed',
        description: error,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Version activated',
        description: 'Changes will take effect within ~60 seconds.',
      });
      void loadPrompts();
    }
  }

  async function handleRestoreDefault() {
    const def = defaultVersion(currentVersions);
    if (!def) {
      toast({ title: 'No default version found', variant: 'destructive' });
      return;
    }
    handleActivateVersion(def.id, `v${def.version} "${def.label ?? 'Default'}" (default)`);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  const selectedMeta = PROMPT_KEYS.find(p => p.key === selectedKey)!;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-foreground">Prompts</h2>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex min-h-[600px]">
          {/* Sidebar — key selector */}
          <div className="w-48 border-r border-border bg-secondary/30 shrink-0">
            <ul className="py-2">
              {PROMPT_KEYS.map(({ key, label }) => (
                <li key={key}>
                  <button
                    onClick={() => {
                      setSelectedKey(key);
                      setEditing(false);
                      setPreviewContent(null);
                    }}
                    className={[
                      'w-full text-left px-4 py-2.5 text-sm transition-colors',
                      selectedKey === key
                        ? 'bg-background text-foreground font-medium border-r-2 border-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
                    ].join(' ')}
                  >
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Content pane */}
          <div className="flex-1 p-6 space-y-6 min-w-0">
            {/* Description and active version header */}
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{selectedMeta.description}</p>
              {selectedKey === 'agent_skill' && (
                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                  Required placeholder: {'{{CHANNEL_MAPPING}}'}
                </p>
              )}
            </div>

            {/* Cache notice */}
            <div className="rounded-md bg-secondary px-3 py-2 text-xs text-muted-foreground">
              Changes go live within ~60 seconds after activation (isolate cache TTL).
            </div>

            {!editing ? (
              <>
                {/* Read-only view of active version */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>
                      Active version:{' '}
                      {active
                        ? `v${active.version}${active.label ? ` "${active.label}"` : ''}`
                        : 'None'}
                    </Label>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={startEditing}>
                        New Version
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleRestoreDefault}
                        disabled={
                          active?.is_default === true ||
                          !defaultVersion(currentVersions)
                        }
                      >
                        Restore Default
                      </Button>
                    </div>
                  </div>

                  <Textarea
                    readOnly
                    value={active?.content ?? '(no active version)'}
                    className="font-mono text-xs h-64 resize-y"
                    aria-label="Active prompt content (read only)"
                  />
                </div>

                {/* Preview pane */}
                {previewContent !== null && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Preview</Label>
                      <Button size="sm" variant="ghost" onClick={() => setPreviewContent(null)}>
                        Close Preview
                      </Button>
                    </div>
                    <div className="rounded-md border border-border bg-secondary/30 p-3 text-xs font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                      {previewContent}
                    </div>
                  </div>
                )}

                {/* Version history */}
                <div className="space-y-2">
                  <Label>Version History</Label>
                  {currentVersions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No versions yet.</p>
                  ) : (
                    <div className="rounded-lg border border-border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-secondary text-muted-foreground">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium">Version</th>
                            <th className="text-left px-3 py-2 font-medium">Label</th>
                            <th className="text-left px-3 py-2 font-medium">Date</th>
                            <th className="text-left px-3 py-2 font-medium w-36">Status</th>
                            <th className="text-left px-3 py-2 font-medium w-40">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {[...currentVersions]
                            .sort((a, b) => b.version - a.version)
                            .map(v => (
                              <tr
                                key={v.id}
                                className={v.is_active ? 'bg-secondary/20' : ''}
                              >
                                <td className="px-3 py-2 font-mono text-xs">v{v.version}</td>
                                <td className="px-3 py-2 text-muted-foreground">
                                  {v.label ?? '—'}
                                </td>
                                <td className="px-3 py-2 text-muted-foreground text-xs">
                                  {formatDate(v.created_at)}
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex gap-1 flex-wrap">
                                    {v.is_active && (
                                      <span className="inline-flex items-center rounded-full bg-success/10 text-success px-1.5 py-0.5 text-xs font-medium">
                                        active
                                      </span>
                                    )}
                                    {v.is_default && (
                                      <span className="inline-flex items-center rounded-full bg-secondary text-muted-foreground px-1.5 py-0.5 text-xs font-medium">
                                        default
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => setPreviewContent(v.content)}
                                    >
                                      Preview
                                    </Button>
                                    {!v.is_active && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        loading={activating === v.id}
                                        disabled={activating !== null}
                                        onClick={() =>
                                          handleActivateVersion(
                                            v.id,
                                            `v${v.version}${v.label ? ` "${v.label}"` : ''}`
                                          )
                                        }
                                      >
                                        Activate
                                      </Button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* Edit mode */
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="version-label">Version Label (optional)</Label>
                  <input
                    id="version-label"
                    type="text"
                    placeholder="e.g. Q3 rewrite"
                    value={draftLabel}
                    onChange={e => setDraftLabel(e.target.value)}
                    maxLength={100}
                    className="flex h-9 w-full max-w-sm rounded-[6px] border border-input bg-background px-3 py-1 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="prompt-content">Prompt Content</Label>
                  {selectedKey === 'agent_skill' && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      This prompt must include {'{{CHANNEL_MAPPING}}'}. Removing it will cause activation to fail.
                    </p>
                  )}
                  <Textarea
                    id="prompt-content"
                    value={draftContent}
                    onChange={e => setDraftContent(e.target.value)}
                    className="font-mono text-xs h-80 resize-y"
                    placeholder="Enter prompt text..."
                    aria-describedby="char-count"
                  />
                  <p id="char-count" className="text-xs text-muted-foreground text-right">
                    {draftContent.length.toLocaleString()} / 100,000 characters
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => void handleSaveAndActivate()}
                    loading={saving}
                    disabled={saving}
                  >
                    Save & Activate
                  </Button>
                  <Button
                    variant="outline"
                    onClick={cancelEditing}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirm activation dialog */}
      <Dialog
        open={confirmDialog.open}
        onOpenChange={open => setConfirmDialog(prev => ({ ...prev, open }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activate Prompt Version?</DialogTitle>
            <DialogDescription>
              You are about to activate{' '}
              <strong>{confirmDialog.versionLabel}</strong> for{' '}
              <strong>{selectedMeta.label}</strong>. This will update the active
              prompt immediately. All requests in the next ~60 seconds may use
              either version while isolate caches refresh.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDialog(prev => ({ ...prev, open: false }))}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (confirmDialog.versionId) {
                  void confirmActivateVersion();
                } else {
                  void confirmSaveAndActivate();
                }
              }}
            >
              Activate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
