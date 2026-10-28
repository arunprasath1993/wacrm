'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Plus,
  Trash2,
  Pencil,
  RefreshCw,
  BookOpen,
  Upload,
  FileText,
  Download,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { uploadAccountMedia } from '@/lib/storage/upload-media';
import {
  KB_BUCKET,
  KB_FILE_EXTENSIONS,
  KB_MAX_FILE_BYTES,
  KB_MAX_FILES,
} from '@/lib/ai/kb-files';

interface DocSummary {
  id: string;
  title: string;
  updated_at: string;
  /** Absent until migration 062 is applied. */
  source_type?: 'text' | 'pdf' | 'docx';
  file_name?: string | null;
  file_size?: number | null;
}

/** Editor target: 'new' when creating, a doc id when editing, null when closed. */
type EditTarget = 'new' | string | null;

/** One row of the per-file upload progress list. */
interface UploadRow {
  key: string;
  name: string;
  status: 'queued' | 'uploading' | 'processing' | 'done' | 'failed';
  message?: string;
  /** Imported, but indexing degraded (API `warning`). */
  warning?: boolean;
}

const MIME_BY_EXT: Record<(typeof KB_FILE_EXTENSIONS)[number], string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const ACCEPT = [
  ...KB_FILE_EXTENSIONS.map((e) => `.${e}`),
  ...Object.values(MIME_BY_EXT),
].join(',');

const MAX_MB = KB_MAX_FILE_BYTES / 1024 / 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AiKnowledgeCard({
  accountId,
  canEdit,
  hasEmbeddingsKey,
}: {
  accountId: string | null;
  canEdit: boolean;
  hasEmbeddingsKey: boolean;
}) {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditTarget>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadedAccountIdRef = useRef<string | null>(null);
  const t = useTranslations('Settings.aiKnowledge');

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/knowledge');
      const data = await res.json();
      if (res.ok) setDocs(data.documents ?? []);
      else toast.error(data.error ?? t('loadFailed'));
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchDocs();
  }, [accountId, fetchDocs]);

  const openNew = () => {
    setEditing('new');
    setTitle('');
    setContent('');
  };

  const openEdit = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/knowledge/${id}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('openFailed'));
        return;
      }
      setEditing(id);
      setTitle(data.title ?? '');
      setContent(data.content ?? '');
    } catch {
      toast.error(t('openFailed'));
    }
  };

  const cancelEdit = () => {
    setEditing(null);
    setTitle('');
    setContent('');
  };

  const save = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error(t('titleContentRequired'));
      return;
    }
    setSaving(true);
    try {
      const isNew = editing === 'new';
      const res = await fetch(
        isNew ? '/api/ai/knowledge' : `/api/ai/knowledge/${editing}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), content: content.trim() }),
        },
      );
      const data = await res.json();
      if (res.ok) {
        // A 200 with `warning` means saved but indexing degraded.
        if (data.warning) toast.warning(data.warning);
        else toast.success(isNew ? t('saveSuccessNew') : t('saveSuccessUpdate'));
        cancelEdit();
        await fetchDocs();
      } else {
        toast.error(data.error ?? t('saveFailed'));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/knowledge/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('removeSuccess'));
        setDocs((d) => d.filter((x) => x.id !== id));
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    }
  };

  const setRow = (key: string, patch: Partial<UploadRow>) =>
    setUploads((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /**
   * Upload + import files one at a time: browser → private Storage
   * bucket, then POST /files extracts the text server-side. Sequential
   * so the per-file status reads top to bottom and a big batch doesn't
   * hammer the rate limit. Each file fails on its own.
   */
  const uploadFiles = async (files: File[]) => {
    if (files.length === 0 || uploading) return;
    if (files.length > KB_MAX_FILES) {
      toast.error(t('tooManyFiles', { max: KB_MAX_FILES }));
      return;
    }

    const batch = files.map((file, i) => {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const row: UploadRow = { key: `${Date.now()}-${i}`, name: file.name, status: 'queued' };
      if (ext === 'doc') return { file, row: { ...row, status: 'failed' as const, message: t('legacyDoc') } };
      if (!(KB_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
        return { file, row: { ...row, status: 'failed' as const, message: t('unsupportedType') } };
      }
      if (file.size > KB_MAX_FILE_BYTES) {
        return { file, row: { ...row, status: 'failed' as const, message: t('fileTooBig', { mb: MAX_MB }) } };
      }
      return { file, row };
    });

    setUploads(batch.map((b) => b.row));
    setUploading(true);
    try {
      for (const { file, row } of batch) {
        if (row.status === 'failed') continue;
        try {
          setRow(row.key, { status: 'uploading' });
          // Some browsers report an empty MIME type for .docx; the bucket
          // only accepts the two exact types, so set it from the extension.
          const ext = file.name.split('.').pop()!.toLowerCase() as keyof typeof MIME_BY_EXT;
          const typed = file.type === MIME_BY_EXT[ext] ? file : new File([file], file.name, { type: MIME_BY_EXT[ext] });
          const { path } = await uploadAccountMedia(KB_BUCKET, typed);

          setRow(row.key, { status: 'processing' });
          const res = await fetch('/api/ai/knowledge/files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_path: path, file_name: file.name }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            setRow(row.key, { status: 'done', message: data.warning, warning: Boolean(data.warning) });
          } else {
            setRow(row.key, { status: 'failed', message: data.error ?? t('uploadFailed') });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : '';
          setRow(row.key, {
            status: 'failed',
            // Storage says "Bucket not found" until migration 062 has
            // created the `ai-knowledge` bucket — say what to do instead.
            message: /bucket not found/i.test(message)
              ? t('migrationMissing')
              : message || t('uploadFailed'),
          });
        }
      }
    } finally {
      setUploading(false);
      await fetchDocs();
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!canEdit) return;
    void uploadFiles(Array.from(e.dataTransfer.files));
  };

  const reindex = async () => {
    setReindexing(true);
    try {
      const res = await fetch('/api/ai/knowledge/reindex', { method: 'POST' });
      const data = await res.json();
      const failed: string[] = Array.isArray(data.failed) ? data.failed : [];
      const keywordOnly: string[] = Array.isArray(data.keyword_only) ? data.keyword_only : [];
      if (res.ok && failed.length > 0) {
        const titleById = new Map(docs.map((d) => [d.id, d.title]));
        toast.error(
          t('reindexWithFailures', {
            reindexed: data.reindexed,
            total: data.total,
            failedCount: failed.length,
            titles: failed.map((id) => titleById.get(id) ?? id).join(', '),
          }),
        );
      } else if (res.ok && data.success && keywordOnly.length > 0) {
        toast.warning(
          t('reindexKeywordOnly', {
            count: data.reindexed,
            keywordOnlyCount: keywordOnly.length,
          }),
        );
      } else if (res.ok && data.success) {
        toast.success(t('reindexSuccess', { count: data.reindexed }));
      } else {
        toast.error(data.error ?? t('reindexFailed'));
      }
    } catch {
      toast.error(t('reindexFailed'));
    } finally {
      setReindexing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4 text-primary" /> {t('title')}
        </CardTitle>
        <CardDescription>
          {t('description', {
            searchType: hasEmbeddingsKey ? t('semanticSearchOn') : t('keywordSearchOn')
          })}
        </CardDescription>
      </CardHeader>
      <CardContent
        className={cn(
          'relative space-y-4',
          dragging && 'rounded-md outline-2 outline-dashed outline-primary',
        )}
        onDragOver={(e) => {
          if (!canEdit || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          // Ignore leave events fired when crossing into a child element.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md bg-background/80 text-sm font-medium text-primary">
            <Upload className="mr-2 h-4 w-4" /> {t('dropHere')}
          </div>
        )}
        {loading ? (
          <div className="flex items-center py-4 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loading')}
          </div>
        ) : (
          <>
            {docs.length === 0 && editing === null && (
              <p className="text-sm text-muted-foreground">
                {t('noDocs')}
              </p>
            )}

            {docs.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {docs.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {doc.source_type && doc.source_type !== 'text' && (
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate text-sm text-foreground">{doc.title}</span>
                      {doc.source_type && doc.source_type !== 'text' && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] uppercase text-muted-foreground">
                          {doc.source_type}
                          {doc.file_size ? ` · ${formatSize(doc.file_size)}` : ''}
                        </span>
                      )}
                    </span>
                    {(canEdit || (doc.source_type && doc.source_type !== 'text')) && (
                      <span className="flex shrink-0 gap-1">
                        {doc.source_type && doc.source_type !== 'text' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => window.open(`/api/ai/knowledge/${doc.id}/file`, '_blank')}
                            title={t('downloadFile')}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        )}
                        {canEdit && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => void openEdit(doc.id)}
                              title={t('editDoc')}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                              onClick={() => void remove(doc.id)}
                              title={t('deleteDoc')}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {editing !== null ? (
              <div className="space-y-3 rounded-md border border-border p-3">
                <div className="space-y-2">
                  <Label htmlFor="kb-title">{t('editDocTitle')}</Label>
                  <Input
                    id="kb-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t('editDocTitlePlaceholder')}
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="kb-content">{t('editDocContent')}</Label>
                  <Textarea
                    id="kb-content"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={t('editDocContentPlaceholder')}
                    rows={8}
                    disabled={saving}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={cancelEdit} disabled={saving}>
                    {t('cancel')}
                  </Button>
                  <Button onClick={save} disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t('saveDoc')}
                  </Button>
                </div>
              </div>
            ) : (
              canEdit && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={openNew} disabled={uploading}>
                        <Plus className="mr-2 h-4 w-4" /> {t('addDoc')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                      >
                        {uploading ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="mr-2 h-4 w-4" />
                        )}
                        {t('uploadFiles')}
                      </Button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept={ACCEPT}
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? []);
                          // Reset so picking the same file again re-fires onChange.
                          e.target.value = '';
                          void uploadFiles(files);
                        }}
                      />
                    </div>
                    {hasEmbeddingsKey && docs.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={reindex}
                        disabled={reindexing}
                        title={t('reindexTooltip')}
                      >
                        {reindexing ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-2 h-4 w-4" />
                        )}
                        {t('reindex')}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('uploadHint', { max: KB_MAX_FILES, mb: MAX_MB })}
                  </p>
                </div>
              )
            )}

            {uploads.length > 0 && (
              <div className="space-y-1 rounded-md border border-border p-2">
                {uploads.map((row) => (
                  <div key={row.key} className="flex items-start gap-2 px-1 py-1 text-sm">
                    <UploadStatusIcon row={row} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-foreground">{row.name}</div>
                      {(row.message || row.status === 'uploading' || row.status === 'processing') && (
                        <div
                          className={cn(
                            'text-xs',
                            row.status === 'failed'
                              ? 'text-destructive'
                              : row.warning
                                ? 'text-amber-500'
                                : 'text-muted-foreground',
                          )}
                        >
                          {row.message ??
                            (row.status === 'uploading' ? t('statusUploading') : t('statusProcessing'))}
                        </div>
                      )}
                    </div>
                    {row.status === 'done' && !row.warning && (
                      <span className="shrink-0 text-xs text-muted-foreground">{t('statusDone')}</span>
                    )}
                  </div>
                ))}
                {!uploading && (
                  <div className="flex justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setUploads([])}>
                      {t('clearUploads')}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function UploadStatusIcon({ row }: { row: UploadRow }) {
  const cls = 'mt-0.5 h-4 w-4 shrink-0';
  if (row.status === 'failed') return <XCircle className={cn(cls, 'text-destructive')} />;
  if (row.status === 'done' && row.warning)
    return <AlertTriangle className={cn(cls, 'text-amber-500')} />;
  if (row.status === 'done') return <CheckCircle2 className={cn(cls, 'text-primary')} />;
  if (row.status === 'queued') return <FileText className={cn(cls, 'text-muted-foreground')} />;
  return <Loader2 className={cn(cls, 'animate-spin text-muted-foreground')} />;
}
