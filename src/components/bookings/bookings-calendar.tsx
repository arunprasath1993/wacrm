'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { zonedDayKey } from '@/lib/ai/usage-days';
import { cn } from '@/lib/utils';
import { contactLabel, type BookingListItem } from './shared';

type View = 'month' | 'week';

const DAY_MS = 86_400_000;

/** Calendar days are plain date arithmetic, kept in UTC to avoid DST. */
function dayFromKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

function keyFromDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

function addDays(day: Date, count: number): Date {
  return new Date(day.getTime() + count * DAY_MS);
}

/** Monday-first, matching how the week reads in India. */
function startOfWeek(day: Date): Date {
  return addDays(day, -((day.getUTCDay() + 6) % 7));
}

function visibleDays(anchor: Date, view: View): Date[] {
  if (view === 'week') {
    const start = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const start = startOfWeek(first);
  // Six rows always fit a month and keep the grid from jumping height.
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function moved(anchor: Date, view: View, direction: 1 | -1): Date {
  if (view === 'week') return addDays(anchor, 7 * direction);
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + direction, 1));
}

export function BookingsCalendar({
  bookings,
  timeZone,
  onSelect,
}: {
  bookings: BookingListItem[];
  timeZone: string;
  onSelect: (booking: BookingListItem) => void;
}) {
  const t = useTranslations('Bookings');
  const todayKey = zonedDayKey(new Date(), timeZone);
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(() => dayFromKey(todayKey));

  const byDay = useMemo(() => {
    const map = new Map<string, BookingListItem[]>();
    for (const booking of bookings) {
      if (!booking.scheduled_at || booking.status === 'cancelled') continue;
      const key = zonedDayKey(booking.scheduled_at, timeZone);
      map.set(key, [...(map.get(key) ?? []), booking]);
    }
    return map;
  }, [bookings, timeZone]);

  const days = visibleDays(anchor, view);
  const heading = new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(anchor);
  const weekdays = days.slice(0, 7).map((day) =>
    new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short' }).format(day),
  );
  const timeFormat = new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('previous')}
            onClick={() => setAnchor((a) => moved(a, view, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('next')}
            onClick={() => setAnchor((a) => moved(a, view, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 text-sm font-medium text-foreground">{heading}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setAnchor(dayFromKey(todayKey))}>
            {t('today')}
          </Button>
          <Button
            variant={view === 'month' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setView('month')}
          >
            {t('month')}
          </Button>
          <Button
            variant={view === 'week' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setView('week')}
          >
            {t('week')}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-7 border-b border-border text-xs text-muted-foreground">
            {weekdays.map((name) => (
              <div key={name} className="px-2 py-1.5">
                {name}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const key = keyFromDay(day);
              const items = byDay.get(key) ?? [];
              const outside =
                view === 'month' && day.getUTCMonth() !== anchor.getUTCMonth();
              return (
                <div
                  key={key}
                  className={cn(
                    'border-b border-r border-border p-1.5',
                    view === 'month' ? 'min-h-24' : 'min-h-64',
                    outside && 'bg-muted/40',
                  )}
                >
                  <div
                    className={cn(
                      'mb-1 text-xs',
                      key === todayKey
                        ? 'font-semibold text-primary'
                        : 'text-muted-foreground',
                    )}
                  >
                    {day.getUTCDate()}
                  </div>
                  <div className="space-y-1">
                    {items.map((booking) => (
                      <button
                        key={booking.id}
                        type="button"
                        onClick={() => onSelect(booking)}
                        className={cn(
                          'block w-full truncate rounded px-1.5 py-0.5 text-left text-xs',
                          booking.status === 'done'
                            ? 'bg-muted text-muted-foreground line-through'
                            : booking.status === 'needs_review'
                              ? 'bg-destructive/10 text-destructive'
                              : 'bg-primary/10 text-primary hover:bg-primary/20',
                        )}
                      >
                        {timeFormat.format(new Date(booking.scheduled_at!))}{' '}
                        {contactLabel(booking) || booking.booking_type?.name}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
