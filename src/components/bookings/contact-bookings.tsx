'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarClock, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { canSendMessages } from '@/lib/auth/roles';
import type { AccountMember } from '@/types';
import { BookingDialog } from './booking-dialog';
import { NewBookingDialog, type BookingTypeOption } from './new-booking-dialog';
import {
  BookingStatusBadge,
  bookingWhen,
  type BookingListItem,
} from './shared';

/**
 * A contact's bookings, so whoever opens the chat sees what was agreed
 * without leaving it. Renders nothing for an account with no booking
 * types and no bookings.
 */
export function ContactBookings({
  contact,
}: {
  contact: { id: string; name?: string | null; phone?: string | null };
}) {
  const t = useTranslations('Bookings');
  const { accountRole } = useAuth();
  const canEdit = accountRole ? canSendMessages(accountRole) : false;
  const [bookings, setBookings] = useState<BookingListItem[]>([]);
  const [timeZone, setTimeZone] = useState('UTC');
  const [types, setTypes] = useState<BookingTypeOption[]>([]);
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [selected, setSelected] = useState<BookingListItem | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/bookings?contact_id=${contact.id}`);
    if (!res.ok) return;
    const data = await res.json();
    setBookings(data.bookings ?? []);
    setTimeZone(data.time_zone ?? 'UTC');
  }, [contact.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void fetch('/api/booking-types')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) =>
        setTypes(
          ((data?.booking_types ?? []) as (BookingTypeOption & { is_active: boolean })[]).filter(
            (type) => type.is_active,
          ),
        ),
      );
    void fetch('/api/account/members')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMembers(data?.members ?? []));
  }, [load]);

  if (bookings.length === 0 && types.length === 0) return null;

  return (
    <div>
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <CalendarClock className="h-3 w-3" />
          {t('title')}
        </div>
        {canEdit && types.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            aria-label={t('newBooking')}
            onClick={() => setCreating(true)}
          >
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>

      <div className="mt-2 space-y-2">
        {bookings.map((booking) => (
          <button
            key={booking.id}
            type="button"
            onClick={() => setSelected(booking)}
            className="w-full rounded-lg bg-muted px-3 py-2 text-left hover:bg-muted/70"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-foreground">
                {booking.booking_type?.name}
              </span>
              <BookingStatusBadge status={booking.status} />
            </div>
            {bookingWhen(booking, timeZone) && (
              <p className="mt-1 text-xs text-muted-foreground">
                {bookingWhen(booking, timeZone)}
              </p>
            )}
          </button>
        ))}
      </div>

      {selected && (
        <BookingDialog
          booking={selected}
          timeZone={timeZone}
          members={members}
          canEdit={canEdit}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
      {creating && (
        <NewBookingDialog
          types={types}
          members={members}
          contact={{
            id: contact.id,
            name: contact.name ?? null,
            phone: contact.phone ?? null,
          }}
          onClose={() => setCreating(false)}
          onCreated={load}
        />
      )}
    </div>
  );
}
