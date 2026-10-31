'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { CalendarClock, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { selectClassName } from '@/components/bookings/shared';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import type {
  BookingContactField,
  BookingFieldDef,
  BookingTimeMode,
  BookingType,
} from '@/lib/bookings/types';
import type { AccountMember } from '@/types';
import { SettingsPanelHead } from './settings-panel-head';

interface StoredType extends BookingType {
  is_active: boolean;
}

interface Draft {
  id?: string;
  name: string;
  fields: BookingFieldDef[];
  time_mode: BookingTimeMode;
  duration_minutes: number;
  instructions: string;
  assignee_user_id: string;
  handoff_on_confirm: boolean;
  remind_enabled: boolean;
  remind_minutes_before: number;
  is_active: boolean;
}

const EMPTY_FIELD: BookingFieldDef = { key: '', label: '', required: true, maps_to: null };

const EMPTY_DRAFT: Draft = {
  name: '',
  fields: [{ ...EMPTY_FIELD }],
  time_mode: 'required',
  duration_minutes: 30,
  instructions: '',
  assignee_user_id: '',
  handoff_on_confirm: false,
  remind_enabled: true,
  remind_minutes_before: 60,
  is_active: true,
};

function toDraft(type: StoredType): Draft {
  return {
    id: type.id,
    name: type.name,
    fields: type.fields,
    time_mode: type.time_mode,
    duration_minutes: type.duration_minutes,
    instructions: type.instructions ?? '',
    assignee_user_id: type.assignee_user_id ?? '',
    handoff_on_confirm: type.handoff_on_confirm,
    remind_enabled: type.remind_minutes_before !== null,
    remind_minutes_before: type.remind_minutes_before ?? 60,
    is_active: type.is_active,
  };
}

/**
 * Settings → Booking Types. Each business defines what its AI agent
 * records: an online demo for one, an installation visit or a callback
 * for another. The timezone lives here too, since it decides what
 * "tomorrow at 11" means; `accounts_update` RLS restricts it to admins.
 */
export function BookingTypesSettings() {
  const t = useTranslations('Settings.bookingTypes');
  const { accountId, canEditSettings } = useAuth();
  const [types, setTypes] = useState<StoredType[] | null>(null);
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [timeZone, setTimeZone] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/booking-types');
    const data = res.ok ? await res.json() : null;
    setTypes(data?.booking_types ?? []);
  }, []);

  useEffect(() => {
    void load();
    void fetch('/api/account/members')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMembers(data?.members ?? []));
  }, [load]);

  useEffect(() => {
    if (!accountId) return;
    void createClient()
      .from('accounts')
      .select('time_zone')
      .eq('id', accountId)
      .maybeSingle()
      .then(({ data }) => setTimeZone((data?.time_zone as string) ?? ''));
  }, [accountId]);

  async function saveTimeZone(next: string) {
    if (!accountId) return;
    setTimeZone(next);
    const { error } = await createClient()
      .from('accounts')
      .update({ time_zone: next })
      .eq('id', accountId);
    if (error) toast.error(t('timeZoneFailed'));
    else toast.success(t('timeZoneSaved'));
  }

  function updateField(index: number, patch: Partial<BookingFieldDef>) {
    setDraft((prev) =>
      prev && {
        ...prev,
        fields: prev.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)),
      },
    );
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const { id, remind_enabled, remind_minutes_before, assignee_user_id, ...rest } = draft;
      const res = await fetch(id ? `/api/booking-types/${id}` : '/api/booking-types', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...rest,
          assignee_user_id: assignee_user_id || null,
          remind_minutes_before: remind_enabled ? remind_minutes_before : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('saveFailed'));
        return;
      }
      setDraft(null);
      await load();
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function archive(type: StoredType) {
    if (!window.confirm(t('archiveConfirm', { name: type.name }))) return;
    const res = await fetch(`/api/booking-types/${type.id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error(t('saveFailed'));
      return;
    }
    await load();
  }

  const zones = Intl.supportedValuesOf('timeZone');
  // The stored zone may be an alias missing from the list (Asia/Kolkata
  // vs Asia/Calcutta), and a select can't show a value it has no option for.
  const zoneOptions = timeZone && !zones.includes(timeZone) ? [timeZone, ...zones] : zones;

  return (
    <div>
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          canEditSettings ? (
            <Button onClick={() => setDraft({ ...EMPTY_DRAFT, fields: [{ ...EMPTY_FIELD }] })}>
              <Plus className="mr-1.5 h-4 w-4" /> {t('new')}
            </Button>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <CardContent className="space-y-1.5 py-4">
          <Label htmlFor="account-time-zone">{t('timeZone')}</Label>
          <select
            id="account-time-zone"
            className={`${selectClassName} max-w-sm`}
            value={timeZone}
            disabled={!canEditSettings}
            onChange={(e) => void saveTimeZone(e.target.value)}
          >
            {zoneOptions.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{t('timeZoneDesc')}</p>
        </CardContent>
      </Card>

      {types === null ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : types.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <CalendarClock className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
          <p className="text-sm font-medium text-foreground">{t('emptyTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('emptyDesc')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {types.map((type) => (
            <li
              key={type.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {type.name}
                  {!type.is_active && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {t('inactive')}
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {type.fields.map((f) => f.label).join(', ') || t('noFields')}
                </p>
              </div>
              {canEditSettings && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('edit')}
                    onClick={() => setDraft(toDraft(type))}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('archive')}
                    onClick={() => void archive(type)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? t('edit') : t('new')}</DialogTitle>
          </DialogHeader>

          {draft && (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="type-name">{t('name')}</Label>
                <Input
                  id="type-name"
                  value={draft.name}
                  placeholder={t('namePlaceholder')}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>{t('fields')}</Label>
                <p className="text-xs text-muted-foreground">{t('fieldsDesc')}</p>
                {draft.fields.map((field, index) => (
                  <div key={index} className="flex flex-wrap items-center gap-2">
                    <Input
                      aria-label={t('fieldLabel')}
                      className="min-w-40 flex-1"
                      value={field.label}
                      placeholder={t('fieldLabel')}
                      onChange={(e) => updateField(index, { label: e.target.value })}
                    />
                    <select
                      aria-label={t('mapsTo')}
                      className={`${selectClassName} w-40`}
                      value={field.maps_to ?? ''}
                      onChange={(e) =>
                        updateField(index, {
                          maps_to: (e.target.value || null) as BookingContactField | null,
                        })
                      }
                    >
                      <option value="">{t('mapsToNone')}</option>
                      <option value="name">{t('mapsToName')}</option>
                      <option value="email">{t('mapsToEmail')}</option>
                      <option value="company">{t('mapsToCompany')}</option>
                    </select>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Switch
                        checked={field.required}
                        onCheckedChange={(checked) => updateField(index, { required: checked })}
                      />
                      {t('required')}
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('removeField')}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          fields: draft.fields.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDraft({ ...draft, fields: [...draft.fields, { ...EMPTY_FIELD }] })
                  }
                >
                  <Plus className="mr-1.5 h-4 w-4" /> {t('addField')}
                </Button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="type-time-mode">{t('timeMode')}</Label>
                  <select
                    id="type-time-mode"
                    className={selectClassName}
                    value={draft.time_mode}
                    onChange={(e) =>
                      setDraft({ ...draft, time_mode: e.target.value as BookingTimeMode })
                    }
                  >
                    <option value="required">{t('timeRequired')}</option>
                    <option value="optional">{t('timeOptional')}</option>
                    <option value="none">{t('timeNone')}</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="type-duration">{t('duration')}</Label>
                  <Input
                    id="type-duration"
                    type="number"
                    min={5}
                    max={1440}
                    value={draft.duration_minutes}
                    onChange={(e) =>
                      setDraft({ ...draft, duration_minutes: Number(e.target.value) })
                    }
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="type-instructions">{t('instructions')}</Label>
                <Textarea
                  id="type-instructions"
                  rows={2}
                  value={draft.instructions}
                  placeholder={t('instructionsPlaceholder')}
                  onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="type-assignee">{t('assignee')}</Label>
                  <select
                    id="type-assignee"
                    className={selectClassName}
                    value={draft.assignee_user_id}
                    onChange={(e) =>
                      setDraft({ ...draft, assignee_user_id: e.target.value })
                    }
                  >
                    <option value="">{t('assigneeDefault')}</option>
                    {members.map((member) => (
                      <option key={member.user_id} value={member.user_id}>
                        {member.full_name || member.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="type-remind">{t('remindBefore')}</Label>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={draft.remind_enabled}
                      aria-label={t('remindEnabled')}
                      onCheckedChange={(checked) =>
                        setDraft({ ...draft, remind_enabled: checked })
                      }
                    />
                    <Input
                      id="type-remind"
                      type="number"
                      min={0}
                      max={10080}
                      disabled={!draft.remind_enabled}
                      value={draft.remind_minutes_before}
                      onChange={(e) =>
                        setDraft({ ...draft, remind_minutes_before: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>
              </div>

              <label className="flex items-start justify-between gap-4">
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    {t('handoff')}
                  </span>
                  <span className="block text-xs text-muted-foreground">{t('handoffDesc')}</span>
                </span>
                <Switch
                  checked={draft.handoff_on_confirm}
                  onCheckedChange={(checked) =>
                    setDraft({ ...draft, handoff_on_confirm: checked })
                  }
                />
              </label>

              <label className="flex items-start justify-between gap-4">
                <span>
                  <span className="block text-sm font-medium text-foreground">{t('active')}</span>
                  <span className="block text-xs text-muted-foreground">{t('activeDesc')}</span>
                </span>
                <Switch
                  checked={draft.is_active}
                  onCheckedChange={(checked) => setDraft({ ...draft, is_active: checked })}
                />
              </label>
            </div>
          )}

          <DialogFooter>
            <Button disabled={saving || !draft?.name.trim()} onClick={() => void save()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
