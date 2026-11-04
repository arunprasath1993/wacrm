'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Loader2, MessageSquare } from 'lucide-react';
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
import { toScheduledLocal } from '@/lib/bookings/time';
import type { BookingStatus } from '@/lib/bookings/types';
import type { AccountMember } from '@/types';
import {
  BookingStatusBadge,
  bookingWhen,
  contactLabel,
  selectClassName,
  type BookingListItem,
} from './shared';

/**
 * One booking: everything the bot captured, plus what an agent does
 * next. Shared by the Tasks list, the Calendar and the contact panels,
 * because they all show the same record.
 */
export function BookingDialog({
  booking,
  timeZone,
  members,
  canEdit,
  onClose,
  onChanged,
}: {
  booking: BookingListItem;
  timeZone: string;
  members: AccountMember[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('Bookings');
  const [scheduled, setScheduled] = useState(
    booking.scheduled_at ? toScheduledLocal(booking.scheduled_at, timeZone) : '',
  );
  const [assignee, setAssignee] = useState(booking.assigned_to ?? '');
  const [saving, setSaving] = useState(false);

  const original = booking.scheduled_at
    ? toScheduledLocal(booking.scheduled_at, timeZone)
    : '';

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch(`/api/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('saveFailed'));
        return;
      }
      onChanged();
      onClose();
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  function saveChanges() {
    const body: Record<string, unknown> = {};
    if (scheduled !== original) body.scheduled_local = scheduled || null;
    if (assignee !== (booking.assigned_to ?? '')) body.assigned_to = assignee || null;
    void patch(body);
  }

  function setStatus(status: BookingStatus) {
    void patch({ status });
  }

  const definitions = booking.booking_type?.fields ?? [];
  const details = Object.entries(booking.fields).map(([key, value]) => ({
    key,
    label: definitions.find((f) => f.key === key)?.label ?? key,
    value,
  }));
  const missing = definitions.filter((f) => f.required && !booking.fields[f.key]);
  const isOpen = booking.status === 'open' || booking.status === 'needs_review';

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{booking.booking_type?.name ?? t('booking')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <BookingStatusBadge status={booking.status} />
            <span className="font-medium text-foreground">{contactLabel(booking)}</span>
            {booking.contact?.phone && booking.contact.name && (
              <span className="text-muted-foreground">{booking.contact.phone}</span>
            )}
          </div>

          {details.length > 0 && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg bg-muted px-3 py-2.5 text-sm">
              {details.map((detail) => (
                <div key={detail.key} className="contents">
                  <dt className="text-muted-foreground">{detail.label}</dt>
                  <dd className="break-words text-foreground">{detail.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {booking.status === 'needs_review' && (
            <p className="text-sm text-destructive">
              {t('needsReviewHint', {
                missing: [
                  ...missing.map((f) => f.label),
                  ...(booking.scheduled_at ? [] : [t('time')]),
                ].join(', '),
              })}
            </p>
          )}

          {booking.scheduled_text && (
            <p className="text-sm text-muted-foreground">
              {t('customerSaid', { text: booking.scheduled_text })}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="booking-time">{t('time')}</Label>
              <Input
                id="booking-time"
                type="datetime-local"
                value={scheduled}
                disabled={!canEdit || !isOpen}
                onChange={(e) => setScheduled(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {booking.scheduled_at
                  ? t('shownIn', { when: bookingWhen(booking, timeZone), timeZone })
                  : timeZone}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="booking-assignee">{t('assignedTo')}</Label>
              <select
                id="booking-assignee"
                className={selectClassName}
                value={assignee}
                disabled={!canEdit || !isOpen}
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

          {booking.conversation_id && (
            <Link
              href={`/inbox?c=${booking.conversation_id}`}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <MessageSquare className="h-4 w-4" /> {t('openChat')}
            </Link>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          {canEdit ? (
            <div className="flex gap-2">
              {isOpen ? (
                <>
                  <Button disabled={saving} onClick={() => setStatus('done')}>
                    {t('markDone')}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={saving}
                    onClick={() => setStatus('cancelled')}
                  >
                    {t('cancelBooking')}
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() => setStatus('open')}
                >
                  {t('reopen')}
                </Button>
              )}
            </div>
          ) : (
            <span />
          )}
          {canEdit && isOpen && (
            <Button
              variant="secondary"
              disabled={
                saving ||
                (scheduled === original && assignee === (booking.assigned_to ?? ''))
              }
              onClick={saveChanges}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('saveChanges')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
