'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useFormatter, useTranslations } from 'next-intl'

import { buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AppMark } from '@/components/apps/app-badge'
import { useApps } from '@/hooks/use-apps'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

/**
 * Audience per app: how many contacts each product has, drawn as bars
 * in the app's own colour. Clicking a row focuses the whole CRM on it.
 */
export function AppsCard() {
  const t = useTranslations('Apps')
  const format = useFormatter()
  const { apps, activeApp, setActiveAppId, loading } = useApps()
  const [counts, setCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    Promise.all(
      apps.map(async (a) => {
        if (!a.tag_id) return [a.id, 0] as const
        const { count } = await supabase
          .from('contact_tags')
          .select('id', { count: 'exact', head: true })
          .eq('tag_id', a.tag_id)
        return [a.id, count ?? 0] as const
      }),
    ).then((entries) => {
      if (!cancelled) setCounts(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [apps])

  if (loading) return null

  const max = Math.max(1, ...apps.map((a) => counts[a.id] ?? 0))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">{t('overviewTitle')}</CardTitle>
        <CardDescription>{t('overviewDesc')}</CardDescription>
        <CardAction>
          <Link
            href="/settings?tab=apps"
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'text-muted-foreground')}
          >
            {t('manageApps')}
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {apps.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-2">
            <p className="max-w-[48ch] text-sm text-muted-foreground">{t('overviewEmpty')}</p>
            <Link href="/settings?tab=apps" className={buttonVariants({ size: 'sm' })}>
              {t('addFirstApp')}
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {apps.map((app) => {
              const n = counts[app.id]
              const active = activeApp?.id === app.id
              return (
                <li key={app.id}>
                  <button
                    type="button"
                    onClick={() => setActiveAppId(app.id)}
                    aria-pressed={active}
                    className={cn(
                      'grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted',
                      active && 'bg-muted',
                    )}
                  >
                    <AppMark app={app} size={26} className="row-span-2" />
                    <span className="truncate text-sm font-medium text-foreground">{app.name}</span>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {n == null ? '—' : format.number(n)}
                    </span>
                    <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full transition-[width] duration-500"
                        style={{
                          width: `${n == null ? 0 : Math.max(2, (n / max) * 100)}%`,
                          backgroundColor: app.color,
                        }}
                      />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
