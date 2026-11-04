'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';
import type { BookingFieldDef } from '@/lib/bookings/types';
import type { AccountMember } from '@/types';
import { selectClassName } from './shared';

export interface BookingTypeOption {
  id: string;
  name: string;
  fields: BookingFieldDef[];
  time_mode: 'required' | 'optional' | 'none';
  assignee_user_id: string | null;
}

interface ContactOption {
  id: string;
  name: string | null;
  phone: string | null;
}

/**
 * Add a booking by hand, for the chats the bot isn't handling. From a
 * contact's panel `contact` is fixed; from the Bookings page the agent
 * searches for one.
 */
export function NewBookingDialog({
  types,
  members,
  contact: fixedContact,
  onClose,
  onCreated,
}: {
  types: BookingTypeOption[];
  members: AccountMember[];
  contact?: ContactOption;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations('Bookings');
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const type = useMemo(() => types.find((x) => x.id === typeId), [types, typeId]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [scheduled, setScheduled] = useState('');
  const [assignee, setAssignee] = useState(types[0]?.assignee_user_id ?? '');
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<ContactOption[]>([]);
  const [contact, setContact] = useState<ContactOption | null>(fixedContact ?? null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (fixedContact || contact) return;
    // Commas and parentheses would break out of the `or` filter syntax.
    const term = search.replace(/[,()]/g, ' ').trim();
    if (term.length < 2) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data } = await createClient()
        .from('contacts')
        .select('id, name, phone')
        .or(`name.ilike.%${term}%,phone.ilike.%${term}%`)
        .limit(8);
      if (!cancelled) setMatches((data ?? []) as ContactOption[]);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, contact, fixedContact]);

  function chooseType(id: string) {
    setTypeId(id);
    setFields({});
    setAssignee(types.find((x) => x.id === id)?.assignee_user_id ?? '');
  }

  const incomplete =
    !type ||
    !contact ||
    type.fields.some((f) => f.required && !fields[f.key]?.trim()) ||
    (type.time_mode === 'required' && !scheduled);

  async function create() {
    if (incomplete) return;
    setSaving(true);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_type_id: type.id,
          contact_id: contact.id,
          fields,
          assigned_to: assignee || null,
          ...(scheduled ? { scheduled_local: scheduled } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('saveFailed'));
        return;
      }
      onCreated();
      onClose();
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('newBooking')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-booking-type">{t('type')}</Label>
            <select
              id="new-booking-type"
              className={selectClassName}
              value={typeId}
              onChange={(e) => chooseType(e.target.value)}
            >
              {types.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-booking-contact">{t('contact')}</Label>
            {contact ? (
              <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
                <span>{contact.name || contact.phone}</span>
                {!fixedContact && (
                  <Button variant="ghost" size="sm" onClick={() => setContact(null)}>
                    {t('change')}
                  </Button>
                )}
              </div>
            ) : (
              <>
                <Input
                  id="new-booking-contact"
                  value={search}
                  placeholder={t('searchContact')}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {matches.length > 0 && (
                  <ul className="max-h-40 overflow-y-auto rounded-lg border border-border">
                    {matches.map((match) => (
                      <li key={match.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => setContact(match)}
                        >
                          {match.name || match.phone}
                          {match.name && match.phone && (
                            <span className="ml-2 text-muted-foreground">{match.phone}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {type?.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`new-booking-${field.key}`}>
                {field.label}
                {field.required && ' *'}
              </Label>
              <Input
                id={`new-booking-${field.key}`}
                value={fields[field.key] ?? ''}
                onChange={(e) =>
                  setFields((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
              />
            </div>
          ))}

          <div className="grid gap-4 sm:grid-cols-2">
            {type?.time_mode !== 'none' && (
              <div className="space-y-1.5">
                <Label htmlFor="new-booking-time">
                  {t('time')}
                  {type?.time_mode === 'required' && ' *'}
                </Label>
                <Input
                  id="new-booking-time"
                  type="datetime-local"
                  value={scheduled}
                  onChange={(e) => setScheduled(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="new-booking-assignee">{t('assignedTo')}</Label>
              <select
                id="new-booking-assignee"
                className={selectClassName}
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">{t('unassigned')}</option>
                {members.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.full_name || member.email}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button disabled={incomplete || saving} onClick={create}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
