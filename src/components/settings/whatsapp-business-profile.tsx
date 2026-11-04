'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RotateCcw, Store, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BUSINESS_PROFILE_LIMITS,
  BUSINESS_VERTICALS,
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_MIME_TYPES,
  type BusinessProfile,
  type BusinessProfileFields,
  type BusinessVertical,
} from '@/lib/whatsapp/business-profile-fields';

/**
 * The connected number's WhatsApp Business Profile — what customers see
 * when they open the business's chat info. Unlike Settings → Your
 * profile (the CRM user's own avatar), every save here goes to Meta.
 */

type LoadState =
  | { kind: 'loading' }
  | { kind: 'disconnected' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'ready'; profile: BusinessProfile };

export type Form = Omit<BusinessProfileFields, 'websites'> & { website1: string; website2: string };

export function toForm(p: BusinessProfile): Form {
  return {
    about: p.about,
    address: p.address,
    description: p.description,
    email: p.email,
    vertical: p.vertical,
    website1: p.websites[0] ?? '',
    website2: p.websites[1] ?? '',
  };
}

/** Only the fields the user changed — Meta leaves the rest untouched. */
export function changedFields(form: Form, saved: BusinessProfile): Partial<BusinessProfileFields> {
  const out: Partial<BusinessProfileFields> = {};
  for (const key of ['about', 'address', 'description', 'email'] as const) {
    if (form[key].trim() !== saved[key].trim()) out[key] = form[key].trim();
  }
  if (form.vertical && form.vertical !== saved.vertical) out.vertical = form.vertical;
  const websites = [form.website1, form.website2].map((w) => w.trim()).filter(Boolean);
  if (websites.join('\n') !== saved.websites.join('\n')) out.websites = websites;
  return out;
}

export function WhatsAppBusinessProfile() {
  const t = useTranslations('Settings.whatsapp.businessProfile');
  const tv = useTranslations('Settings.whatsapp.businessProfile.verticals');
  const { canEditSettings } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [form, setForm] = useState<Form | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const res = await fetch('/api/whatsapp/business-profile');
      const data = await res.json();
      if (data.state === 'connected') {
        setState({ kind: 'ready', profile: data.profile });
        setForm(toForm(data.profile));
      } else if (data.state === 'disconnected') {
        setState({ kind: 'disconnected' });
      } else {
        setState({ kind: 'unavailable', message: data.message || data.error || t('loadFailed') });
      }
    } catch {
      setState({ kind: 'unavailable', message: t('loadFailed') });
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const verticalItems = useMemo(
    () => Object.fromEntries(BUSINESS_VERTICALS.map((v) => [v, tv(v)])),
    [tv],
  );

  if (state.kind === 'disconnected') return null;

  const saved = state.kind === 'ready' ? state.profile : null;
  const changes = form && saved ? changedFields(form, saved) : {};
  const dirty = Object.keys(changes).length > 0 || pendingPhoto !== null;
  const disabled = saving || !canEditSettings;
  const photoSrc = previewUrl ?? saved?.profilePictureUrl ?? null;

  const set = (key: keyof Form) => (value: string) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so the same file can be re-picked
    if (!file) return;
    if (!(PROFILE_PHOTO_MIME_TYPES as readonly string[]).includes(file.type)) {
      toast.error(t('photoWrongType'));
      return;
    }
    if (file.size > PROFILE_PHOTO_MAX_BYTES) {
      toast.error(t('photoTooLarge'));
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingPhoto(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !saved || !dirty) return;
    if (changes.about !== undefined && changes.about.length === 0) {
      toast.error(t('aboutRequired'));
      return;
    }

    setSaving(true);
    try {
      const body = new FormData();
      body.set('fields', JSON.stringify(changes));
      if (pendingPhoto) body.set('photo', pendingPhoto);
      const res = await fetch('/api/whatsapp/business-profile', { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(t('saveFailed'), { description: data.error });
        return;
      }

      // Meta's read-back carries the new photo URL; if it failed, keep
      // what we just sent so the form doesn't snap back.
      const next: BusinessProfile = data.profile ?? {
        ...saved,
        ...changes,
        websites: changes.websites ?? saved.websites,
      };
      setState({ kind: 'ready', profile: next });
      setForm(toForm(next));
      if (data.profile) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
      setPendingPhoto(null);
      toast.success(t('saved'), { description: t('savedDesc') });
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">{t('title')}</CardTitle>
        <CardDescription className="text-muted-foreground">{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {state.kind === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('loading')}
          </div>
        )}

        {state.kind === 'unavailable' && (
          <div className="space-y-3">
            <p className="text-sm text-red-400">{state.message}</p>
            <Button type="button" variant="outline" onClick={() => void load()}>
              <RotateCcw className="size-4" />
              {t('retry')}
            </Button>
          </div>
        )}

        {state.kind === 'ready' && form && (
          <form onSubmit={onSave} className="space-y-5">
            {/* Photo */}
            <div className="flex flex-wrap items-center gap-5">
              <Avatar size="lg" className="size-16">
                {photoSrc ? <AvatarImage src={photoSrc} alt={t('photoAlt')} /> : null}
                <AvatarFallback className="bg-primary/10 text-primary">
                  <Store className="size-6" />
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={PROFILE_PHOTO_MIME_TYPES.join(',')}
                  className="hidden"
                  onChange={onPickFile}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled}
                >
                  <Upload className="size-4" />
                  {photoSrc ? t('changePhoto') : t('uploadPhoto')}
                </Button>
                <p className="w-full text-xs text-muted-foreground">{t('photoHint')}</p>
              </div>
            </div>

            {/* About */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="bp-about" className="text-foreground">
                  {t('about')}
                </Label>
                <span className="text-xs text-muted-foreground">
                  {form.about.length}/{BUSINESS_PROFILE_LIMITS.about}
                </span>
              </div>
              <Input
                id="bp-about"
                value={form.about}
                onChange={(e) => set('about')(e.target.value)}
                placeholder={t('aboutPlaceholder')}
                maxLength={BUSINESS_PROFILE_LIMITS.about}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">{t('aboutHint')}</p>
            </div>

            {/* Category */}
            <div className="space-y-2">
              <Label htmlFor="bp-vertical" className="text-foreground">
                {t('category')}
              </Label>
              <Select
                items={verticalItems}
                value={form.vertical || null}
                onValueChange={(v) => set('vertical')((v as BusinessVertical | null) ?? '')}
                disabled={disabled}
              >
                <SelectTrigger id="bp-vertical" className="w-full">
                  <SelectValue placeholder={t('categoryPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {BUSINESS_VERTICALS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {verticalItems[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="bp-description" className="text-foreground">
                  {t('descriptionLabel')}
                </Label>
                <span className="text-xs text-muted-foreground">
                  {form.description.length}/{BUSINESS_PROFILE_LIMITS.description}
                </span>
              </div>
              <Textarea
                id="bp-description"
                value={form.description}
                onChange={(e) => set('description')(e.target.value)}
                placeholder={t('descriptionPlaceholder')}
                maxLength={BUSINESS_PROFILE_LIMITS.description}
                rows={3}
                disabled={disabled}
              />
            </div>

            {/* Address */}
            <div className="space-y-2">
              <Label htmlFor="bp-address" className="text-foreground">
                {t('address')}
              </Label>
              <Input
                id="bp-address"
                value={form.address}
                onChange={(e) => set('address')(e.target.value)}
                maxLength={BUSINESS_PROFILE_LIMITS.address}
                disabled={disabled}
              />
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="bp-email" className="text-foreground">
                {t('email')}
              </Label>
              <Input
                id="bp-email"
                type="email"
                value={form.email}
                onChange={(e) => set('email')(e.target.value)}
                maxLength={BUSINESS_PROFILE_LIMITS.email}
                disabled={disabled}
              />
            </div>

            {/* Websites */}
            <div className="space-y-2">
              <Label htmlFor="bp-website-1" className="text-foreground">
                {t('websites')}
              </Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  id="bp-website-1"
                  type="url"
                  value={form.website1}
                  onChange={(e) => set('website1')(e.target.value)}
                  placeholder="https://"
                  maxLength={BUSINESS_PROFILE_LIMITS.website}
                  disabled={disabled}
                  aria-label={t('website1')}
                />
                <Input
                  id="bp-website-2"
                  type="url"
                  value={form.website2}
                  onChange={(e) => set('website2')(e.target.value)}
                  placeholder="https://"
                  maxLength={BUSINESS_PROFILE_LIMITS.website}
                  disabled={disabled}
                  aria-label={t('website2')}
                />
              </div>
            </div>

            <div className="space-y-1 rounded-md border border-border bg-muted p-3 text-xs text-muted-foreground">
              <p>{t('displayNameNote')}</p>
              <p>{t('propagationNote')}</p>
              {!canEditSettings && <p className="text-amber-500">{t('adminOnly')}</p>}
            </div>

            <Button
              type="submit"
              disabled={disabled || !dirty}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('save')
              )}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
