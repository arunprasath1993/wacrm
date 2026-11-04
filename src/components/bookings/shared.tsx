'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { formatBookingTime } from '@/lib/bookings/time';
import type { BookingFieldDef, BookingStatus } from '@/lib/bookings/types';

export interface BookingListItem {
  id: string;
  status: BookingStatus;
  fields: Record<string, string>;
  scheduled_at: string | null;
  scheduled_text: string | null;
  assigned_to: string | null;
  source: 'ai' | 'manual';
  conversation_id: string | null;
  contact_id: string | null;
  created_at: string;
  booking_type: {
    id: string;
    name: string;
    fields: BookingFieldDef[];
    duration_minutes: number;
  } | null;
  contact: { id: string; name: string | null; phone: string | null } | null;
}

export const selectClassName =
  'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring disabled:opacity-50';

export function contactLabel(booking: BookingListItem): string {
  return booking.contact?.name || booking.contact?.phone || '';
}

export function bookingWhen(booking: BookingListItem, timeZone: string): string {
  if (booking.scheduled_at) return formatBookingTime(booking.scheduled_at, timeZone);
  return booking.scheduled_text ?? '';
}

const STATUS_VARIANT = {
  open: 'default',
  needs_review: 'destructive',
  done: 'secondary',
  cancelled: 'outline',
} as const;

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const t = useTranslations('Bookings.status');
  return <Badge variant={STATUS_VARIANT[status]}>{t(status)}</Badge>;
}
