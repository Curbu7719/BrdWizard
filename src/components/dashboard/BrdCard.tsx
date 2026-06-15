import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreHorizontal, Download, Globe, Lock, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { BrdStatusBadge } from '../shared/StatusBadge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../ui/dropdown-menu';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import type { BrdDocument } from '../../types/brd';
import { useBrdActions } from '../../hooks/useBrd';
import { exportWord } from '../../lib/sse';
import { toast } from '../../hooks/useToast';

interface BrdCardProps {
  brd: BrdDocument;
  isOwner: boolean;
  onDeleted?: () => void;
  onUpdated?: () => void;
}

export function BrdCard({ brd, isOwner, onDeleted, onUpdated }: BrdCardProps) {
  const navigate = useNavigate();
  const { deleteBrd, toggleVisibility } = useBrdActions();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const formattedDate = new Date(brd.updated_at).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  const classificationParts = [
    brd.product_type !== 'unknown' ? brd.product_type.charAt(0).toUpperCase() + brd.product_type.slice(1) : null,
    brd.mobility_type !== 'unknown' ? brd.mobility_type.charAt(0).toUpperCase() + brd.mobility_type.slice(1) : null,
    brd.change_type !== 'unknown' ? (brd.change_type === 'new' ? 'New' : 'Change') : null,
  ].filter(Boolean);

  async function handleExport() {
    setExporting(true);
    const { error } = await exportWord(brd.id, brd.title);
    setExporting(false);
    if (error) toast({ title: 'Export failed', description: error, variant: 'destructive' });
  }

  async function handleDelete() {
    setDeleting(true);
    const { error } = await deleteBrd(brd.id);
    setDeleting(false);
    if (error) {
      toast({ title: 'Delete failed', description: error, variant: 'destructive' });
    } else {
      setConfirmDelete(false);
      onDeleted?.();
    }
  }

  async function handleToggleVisibility() {
    const { error } = await toggleVisibility(brd.id, brd.visibility);
    if (error) toast({ title: 'Update failed', description: error, variant: 'destructive' });
    else onUpdated?.();
  }

  return (
    <>
      <div className="rounded-lg border border-border bg-card p-5 shadow-[0_1px_3px_rgba(0,0,0,0.08)] flex flex-col gap-3 hover:border-accent/40 transition-colors">
        {/* Title */}
        <div>
          <h3 className="text-base font-semibold text-foreground leading-snug line-clamp-2">{brd.title}</h3>
          {classificationParts.length > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">{classificationParts.join(' · ')}</p>
          )}
          {brd.impacted_channels.length > 0 && (
            <p className="text-xs text-muted-foreground">Channels: {brd.impacted_channels.join(', ')}</p>
          )}
        </div>

        {/* Status */}
        <div className="flex items-center gap-2">
          <BrdStatusBadge status={brd.status} />
          {brd.visibility === 'public' && (
            <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
              <Globe className="h-3 w-3" aria-hidden="true" />
              Public
            </span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">Last edited: {formattedDate}</p>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-auto pt-1">
          {brd.status === 'draft' ? (
            <Button size="sm" onClick={() => navigate(`/brd/${brd.id}`)}>
              Continue
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/brd/${brd.id}`)}
            >
              Open
            </Button>
          )}

          {brd.status === 'complete' && (
            <Button size="sm" variant="outline" loading={exporting} onClick={handleExport}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export Word
            </Button>
          )}

          {isOwner && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="ml-auto h-8 w-8" aria-label="More options">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => navigate(`/brd/${brd.id}`)}>
                  <Pencil className="h-4 w-4 mr-2" aria-hidden="true" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleToggleVisibility}>
                  {brd.visibility === 'public' ? (
                    <>
                      <Lock className="h-4 w-4 mr-2" aria-hidden="true" />
                      Make Private
                    </>
                  ) : (
                    <>
                      <Globe className="h-4 w-4 mr-2" aria-hidden="true" />
                      Make Public
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete BRD"
        description={`Are you sure you want to delete "${brd.title}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleting}
      />
    </>
  );
}
