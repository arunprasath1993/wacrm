'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CalendarClock, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BookingDialog } from '@/components/bookings/booking-dialog';
import { BookingsCalendar } from '@/components/bookings/bookings-calendar';
import {
  NewBookingDialog,
  type BookingTypeOption,
} from '@/components/bookings/new-booking-dialog';
import {
  BookingStatusBadge,
  bookingWhen,
  contactLabel,
  selectClassName,
  type BookingListItem,
} from '@/components/bookings/shared';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings, canSendMessages } from '@/lib/auth/roles';
import type { BookingStatus } from '@/lib/bookings/types';
import type { AccountMember } from '@/types';

const STATUS_FILTERS: (BookingStatus | 'active' | 'all')[] = [
  'active',
  'needs_review',
  'open',
  'done',
  'cancelled',
  'all',
];

// Needs review first (it can't be followed up as it stands), then the
// soonest, with anything unscheduled after the dated work.
function byUrgency(a: BookingListItem, b: BookingListItem): number {
  const review = Number(b.status === 'needs_review') - Number(a.status === 'needs_review');
  if (review !== 0) return review;
  const at = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Infinity;
  const bt = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Infinity;
  return at - bt;
}

// `useSearchParams` needs a Suspense boundary or the production build
// bails out of prerendering — see the note in the settings page.
export default function BookingsPage() {
  return (
    <Suspense fallback={null}>
      <BookingsPageInner />
    </Suspense>
  );
}

function BookingsPageInner() {
  const t = useTranslations('Bookings');
  const searchParams = useSearchParams();
  const linkedId = searchParams.get('booking');
  const { accountRole } = useAuth();
  const canEdit = accountRole ? canSendMessages(accountRole) : false;
  const canConfigure = accountRole ? canEditSettings(accountRole) : false;

  const [bookings, setBookings] = useState<BookingListItem[] | null>(null);
  const [timeZone, setTimeZone] = useState('UTC');
  const [types, setTypes] = useState<BookingTypeOption[]>([]);
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(linkedId);
  const [creating, setCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('active');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/bookings');
    if (!res.ok) {
      setBookings([]);
      return;
    }
    const data = await res.json();
    setBookings(data.bookings ?? []);
    setTimeZone(data.time_zone ?? 'UTC');
  }, []);

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

  const visible = useMemo(() => {
    return (bookings ?? [])
      .filter((b) => {
        if (statusFilter === 'all') return true;
        if (statusFilter === 'active') return b.status === 'open' || b.status === 'needs_review';
        return b.status === statusFilter;
      })
      .filter((b) => !assigneeFilter || b.assigned_to === assigneeFilter)
      .filter((b) => !typeFilter || b.booking_type?.id === typeFilter)
      .sort(byUrgency);
  }, [bookings, statusFilter, assigneeFilter, typeFilter]);

  const selected = bookings?.find((b) => b.id === selectedId) ?? null;
  const memberName = (id: string | null) => {
    const member = members.find((m) => m.user_id === id);
    return member?.full_name || member?.email || t('unassigned');
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CalendarClock className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
        </div>
        {canEdit && types.length > 0 && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> {t('newBooking')}
          </Button>
        )}
      </div>

      {bookings === null ? (
        <div className="mt-10 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs defaultValue="tasks" className="mt-6">
          <TabsList>
            <TabsTrigger value="tasks">{t('tasksTab')}</TabsTrigger>
            <TabsTrigger value="calendar">{t('calendarTab')}</TabsTrigger>
          </TabsList>

          <TabsContent value="tasks" className="mt-4">
            <div className="mb-3 grid gap-2 sm:grid-cols-3">
              <select
                aria-label={t('filterStatus')}
                className={selectClassName}
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as (typeof STATUS_FILTERS)[number])
                }
              >
                {STATUS_FILTERS.map((status) => (
                  <option key={status} value={status}>
                    {t(`filter.${status}`)}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('filterAssignee')}
                className={selectClassName}
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
              >
                <option value="">{t('allAssignees')}</option>
                {members.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.full_name || member.email}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('filterType')}
                className={selectClassName}
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="">{t('allTypes')}</option>
                {types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </div>

            {visible.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-10 text-center">
                <p className="text-sm font-medium text-foreground">{t('emptyTitle')}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {types.length > 0 ? t('emptyDesc') : t('noTypesDesc')}
                </p>
                {types.length === 0 && canConfigure && (
                  <Link
                    href="/settings?tab=booking-types"
                    className="mt-2 inline-block text-sm text-primary hover:underline"
                  >
                    {t('setUpTypes')}
                  </Link>
                )}
              </div>
            ) : (
              <ul className="space-y-2">
                {visible.map((booking) => (
                  <li key={booking.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(booking.id)}
                      className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-border bg-card p-3 text-left hover:border-border/70 hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {contactLabel(booking) || t('noContact')}
                          </span>
                          <BookingStatusBadge status={booking.status} />
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {booking.booking_type?.name}
                          {' · '}
                          {memberName(booking.assigned_to)}
                        </p>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {bookingWhen(booking, timeZone) || t('noTime')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="calendar" className="mt-4">
            <BookingsCalendar
              bookings={bookings}
              timeZone={timeZone}
              onSelect={(booking) => setSelectedId(booking.id)}
            />
          </TabsContent>
        </Tabs>
      )}

      {selected && (
        <BookingDialog
          key={selected.id}
          booking={selected}
          timeZone={timeZone}
          members={members}
          canEdit={canEdit}
          onClose={() => setSelectedId(null)}
          onChanged={load}
        />
      )}
      {creating && (
        <NewBookingDialog
          types={types}
          members={members}
          onClose={() => setCreating(false)}
          onCreated={load}
        />
      )}
    </div>
  );
}
