"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  Check,
  Copy,
  ExternalLink,
  GitBranch,
  Layers,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Tag as TagIcon,
  Trash2,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useApps } from "@/hooks/use-apps";
import { useCan } from "@/hooks/use-can";
import {
  APP_COLORS,
  isValidAppSlug,
  isValidAppUrl,
  slugifyAppName,
} from "@/lib/apps/apps";
import { cn } from "@/lib/utils";
import type { CrmApp } from "@/types";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AppMark } from "@/components/apps/app-badge";
import { SettingsPanelHead } from "./settings-panel-head";

interface Meta {
  tagName: string | null;
  pipelineName: string | null;
  contacts: number | null;
}

/** Settings → Apps: the products this CRM markets. */
export function AppsSettings() {
  const t = useTranslations("Apps");
  const tGate = useTranslations("GatedButton");
  const canEdit = useCan("edit-settings");
  const { allApps, refresh, loading } = useApps();
  const [meta, setMeta] = useState<Record<string, Meta>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CrmApp | null>(null);
  const [deleting, setDeleting] = useState<CrmApp | null>(null);
  const [busy, setBusy] = useState(false);

  // Tag / pipeline names and contact counts for each app.
  const loadMeta = useCallback(async () => {
    if (allApps.length === 0) {
      setMeta({});
      return;
    }
    const supabase = createClient();
    const tagIds = allApps.map((a) => a.tag_id).filter(Boolean) as string[];
    const pipelineIds = allApps.map((a) => a.pipeline_id).filter(Boolean) as string[];
    const [{ data: tags }, { data: pipelines }] = await Promise.all([
      tagIds.length
        ? supabase.from("tags").select("id, name").in("id", tagIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      pipelineIds.length
        ? supabase.from("pipelines").select("id, name").in("id", pipelineIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);
    const counts = await Promise.all(
      allApps.map(async (a) => {
        if (!a.tag_id) return null;
        const { count } = await supabase
          .from("contact_tags")
          .select("id", { count: "exact", head: true })
          .eq("tag_id", a.tag_id);
        return count ?? 0;
      }),
    );
    const next: Record<string, Meta> = {};
    allApps.forEach((a, i) => {
      next[a.id] = {
        tagName: tags?.find((x) => x.id === a.tag_id)?.name ?? null,
        pipelineName: pipelines?.find((x) => x.id === a.pipeline_id)?.name ?? null,
        contacts: counts[i],
      };
    });
    setMeta(next);
  }, [allApps]);

  // Async fetch: state is set after the awaited queries, not synchronously.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMeta();
  }, [loadMeta]);

  const live = allApps.filter((a) => !a.archived_at);
  const archived = allApps.filter((a) => a.archived_at);

  const setArchived = async (app: CrmApp, archive: boolean) => {
    setBusy(true);
    const { error } = await createClient()
      .from("crm_apps")
      .update({ archived_at: archive ? new Date().toISOString() : null })
      .eq("id", app.id);
    setBusy(false);
    if (error) {
      toast.error(t("toastSaveFailed"));
      return;
    }
    toast.success(archive ? t("toastArchived", { name: app.name }) : t("toastRestored", { name: app.name }));
    await refresh();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const { error } = await createClient().from("crm_apps").delete().eq("id", deleting.id);
    setBusy(false);
    if (error) {
      toast.error(t("toastDeleteFailed"));
      return;
    }
    toast.success(t("toastDeleted", { name: deleting.name }));
    setDeleting(null);
    await refresh();
  };

  return (
    <div>
      <SettingsPanelHead
        title={t("panelTitle")}
        description={t("panelDesc")}
        action={
          <GatedButton
            canAct={canEdit}
            gateReason={tGate("reasons.editSettings")}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" />
            {t("newApp")}
          </GatedButton>
        }
      />

      {loading ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : live.length === 0 && archived.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center">
          <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Layers className="size-5" />
          </span>
          <h3 className="text-base font-semibold text-foreground">{t("emptyTitle")}</h3>
          <p className="mx-auto mt-1 max-w-[52ch] text-sm text-muted-foreground">{t("emptyDesc")}</p>
          {canEdit && (
            <Button className="mt-5" onClick={() => setFormOpen(true)}>
              <Plus className="size-4" />
              {t("addFirstApp")}
            </Button>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {live.map((app) => (
            <AppRow
              key={app.id}
              app={app}
              meta={meta[app.id]}
              canEdit={canEdit}
              busy={busy}
              onEdit={() => {
                setEditing(app);
                setFormOpen(true);
              }}
              onArchive={() => setArchived(app, true)}
              onDelete={() => setDeleting(app)}
            />
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{t("archivedTitle")}</h3>
          <ul className="flex flex-col gap-2">
            {archived.map((app) => (
              <li
                key={app.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 opacity-75"
              >
                <AppMark app={app} size={22} />
                <span className="flex-1 truncate text-sm text-foreground">{app.name}</span>
                {canEdit && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setArchived(app, false)}>
                    <ArchiveRestore className="size-4" />
                    {t("restore")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {live.length > 0 && <LeadCaptureGuide apps={live} />}

      <AppFormDialog
        open={formOpen}
        app={editing}
        onOpenChange={setFormOpen}
        onSaved={async () => {
          setFormOpen(false);
          await refresh();
        }}
      />

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle", { name: deleting?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("deleteDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={confirmDelete}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t("deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AppRow({
  app,
  meta,
  canEdit,
  busy,
  onEdit,
  onArchive,
  onDelete,
}: {
  app: CrmApp;
  meta: Meta | undefined;
  canEdit: boolean;
  busy: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("Apps");
  return (
    <li
      className="relative overflow-hidden rounded-xl border border-border bg-card"
      style={{ boxShadow: `inset 4px 0 0 ${app.color}` }}
    >
      <div className="flex items-start gap-4 py-4 pl-5 pr-3">
        <AppMark app={app} size={40} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="truncate text-base font-semibold text-foreground">{app.name}</h3>
            <code className="text-xs text-muted-foreground">{app.slug}</code>
          </div>
          {app.description && (
            <p className="mt-0.5 max-w-[68ch] text-sm text-muted-foreground">{app.description}</p>
          )}
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Users className="size-3.5" />
              <dt className="sr-only">{t("contacts")}</dt>
              <dd className="text-foreground">
                {meta?.contacts == null ? "—" : t("contactCount", { count: meta.contacts })}
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <TagIcon className="size-3.5" />
              <dt>{t("tag")}</dt>
              <dd className={cn("text-foreground", !meta?.tagName && "text-status-serious")}>
                {meta?.tagName ?? (app.tag_id ? "…" : t("tagMissing"))}
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <GitBranch className="size-3.5" />
              <dt>{t("pipeline")}</dt>
              <dd className="text-foreground">{meta?.pipelineName ?? t("noPipeline")}</dd>
            </div>
            {app.website_url && (
              <a
                href={app.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-primary hover:underline"
              >
                <ExternalLink className="size-3.5" />
                {t("website")}
              </a>
            )}
          </dl>
        </div>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t("appActions", { name: app.name })}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44 bg-popover text-popover-foreground ring-border">
              <DropdownMenuItem onClick={onEdit} className="gap-2">
                <Pencil className="size-4" />
                {t("edit")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onArchive} disabled={busy} className="gap-2">
                <Archive className="size-4" />
                {t("archive")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem onClick={onDelete} className="gap-2 text-destructive focus:text-destructive">
                <Trash2 className="size-4" />
                {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}

function AppFormDialog({
  open,
  app,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  app: CrmApp | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<void>;
}) {
  const t = useTranslations("Apps");
  const { accountId } = useAuth();
  const isEdit = !!app;
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [icon, setIcon] = useState("");
  const [color, setColor] = useState<string>(APP_COLORS[0]);
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [signup, setSignup] = useState("");
  const [withPipeline, setWithPipeline] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time the dialog opens (or switches app).
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(app?.name ?? "");
    setSlug(app?.slug ?? "");
    setSlugTouched(!!app);
    setIcon(app?.icon ?? "");
    setColor(app?.color ?? APP_COLORS[0]);
    setDescription(app?.description ?? "");
    setWebsite(app?.website_url ?? "");
    setSignup(app?.signup_url ?? "");
    setWithPipeline(true);
    setError(null);
  }, [open, app]);

  const effectiveSlug = useMemo(
    () => (slugTouched ? slug : slugifyAppName(name)),
    [slugTouched, slug, name],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError(t("errName"));
    if (!isValidAppSlug(effectiveSlug)) return setError(t("errSlug"));
    if (!isValidAppUrl(website) || !isValidAppUrl(signup)) return setError(t("errUrl"));
    if (Array.from(icon.trim()).length > 4) return setError(t("errIcon"));

    setSaving(true);
    const supabase = createClient();
    const fields = {
      name: name.trim(),
      slug: effectiveSlug,
      color,
      icon: icon.trim() || null,
      description: description.trim() || null,
      website_url: website.trim() || null,
      signup_url: signup.trim() || null,
    };
    const { error: dbError } = isEdit
      ? await supabase.from("crm_apps").update(fields).eq("id", app!.id).eq("account_id", accountId ?? "")
      : await supabase.rpc("create_crm_app", {
          p_name: fields.name,
          p_slug: fields.slug,
          p_color: fields.color,
          p_icon: fields.icon,
          p_description: fields.description,
          p_website_url: fields.website_url,
          p_signup_url: fields.signup_url,
          p_create_pipeline: withPipeline,
        });
    setSaving(false);
    if (dbError) {
      setError(dbError.code === "23505" ? t("errSlugTaken") : t("toastSaveFailed"));
      return;
    }
    toast.success(isEdit ? t("toastUpdated", { name: fields.name }) : t("toastCreated", { name: fields.name }));
    await onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("editTitle") : t("createTitle")}</DialogTitle>
          <DialogDescription>{isEdit ? t("editDesc") : t("createDesc")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex items-end gap-3">
            <AppMark app={{ name: name || "?", color, icon: icon.trim() || null }} size={44} />
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="app-name">{t("fieldName")}</Label>
              <Input
                id="app-name"
                value={name}
                maxLength={60}
                autoFocus
                placeholder={t("fieldNamePlaceholder")}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex w-20 flex-col gap-1.5">
              <Label htmlFor="app-icon">{t("fieldIcon")}</Label>
              <Input
                id="app-icon"
                value={icon}
                placeholder="💧"
                onChange={(e) => setIcon(e.target.value)}
                className="text-center"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="app-slug">{t("fieldSlug")}</Label>
            <Input
              id="app-slug"
              value={effectiveSlug}
              maxLength={40}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
            />
            <p className="text-xs text-muted-foreground">{t("fieldSlugHint")}</p>
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium text-foreground">{t("fieldColor")}</legend>
            <div className="flex flex-wrap gap-2">
              {APP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className="flex size-8 items-center justify-center rounded-lg ring-offset-2 ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-ring aria-pressed:ring-2 aria-pressed:ring-foreground"
                  style={{ backgroundColor: c }}
                >
                  {color === c && <Check className="size-4 text-white mix-blend-difference" />}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="app-desc">{t("fieldDescription")}</Label>
            <Textarea
              id="app-desc"
              value={description}
              maxLength={500}
              rows={2}
              placeholder={t("fieldDescriptionPlaceholder")}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="app-web">{t("fieldWebsite")}</Label>
              <Input id="app-web" type="url" value={website} placeholder="https://" onChange={(e) => setWebsite(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="app-signup">{t("fieldSignup")}</Label>
              <Input id="app-signup" type="url" value={signup} placeholder="https://" onChange={(e) => setSignup(e.target.value)} />
            </div>
          </div>

          {!isEdit && (
            <label className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card-2 p-3">
              <span>
                <span className="block text-sm font-medium text-foreground">{t("fieldPipeline")}</span>
                <span className="block text-xs text-muted-foreground">{t("fieldPipelineHint")}</span>
              </span>
              <Switch checked={withPipeline} onCheckedChange={setWithPipeline} />
            </label>
          )}

          {error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? t("saveChanges") : t("createApp")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** How to push sign-ups from the product itself into this CRM. */
function LeadCaptureGuide({ apps }: { apps: CrmApp[] }) {
  const t = useTranslations("Apps");
  const [slug, setSlug] = useState(apps[0]?.slug ?? "");
  const [copied, setCopied] = useState(false);
  const origin = typeof window === "undefined" ? "https://your-crm.example.com" : window.location.origin;
  const snippet = `curl -X POST ${origin}/api/v1/contacts \\
  -H "Authorization: Bearer <API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{"phone":"+919876543210","name":"Customer name","app":"${slug}"}'`;

  return (
    <section className="mt-10 rounded-xl border border-border bg-card p-5">
      <h3 className="text-base font-semibold text-foreground">{t("captureTitle")}</h3>
      <p className="mt-1 max-w-[68ch] text-sm text-muted-foreground">{t("captureDesc")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {apps.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setSlug(a.slug)}
            aria-pressed={slug === a.slug}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-foreground"
          >
            <AppMark app={a} size={14} />
            {a.name}
          </button>
        ))}
      </div>
      <div className="relative mt-3">
        <pre className="overflow-x-auto rounded-lg bg-muted p-3 pr-12 text-xs leading-relaxed text-foreground">
          <code>{snippet}</code>
        </pre>
        <button
          type="button"
          aria-label={t("copy")}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(snippet);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              toast.error(t("copyFailed"));
            }
          }}
          className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground"
        >
          {copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t("captureFoot")}</p>
    </section>
  );
}
