import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSignupMode, isSignupAllowed } from '@/lib/auth/signup-mode'
import { checkSiteGate } from '@/lib/auth/site-gate'

// Static files skip the Supabase session lookup, but still pass the site
// gate so the JS bundle (Supabase URL + anon key) isn't public.
const STATIC_ASSET = /^\/_next\/|^\/favicon\.ico$|\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|css|map|woff2?|wasm)$/

export async function middleware(request: NextRequest) {
  // Site gate (SITE_GATE_USER / SITE_GATE_PASSWORD) — Basic Auth wall in
  // front of everything, including /login. No-op when unset.
  const blocked = await checkSiteGate(request, request.nextUrl.pathname)
  if (blocked) return blocked

  if (STATIC_ASSET.test(request.nextUrl.pathname)) return NextResponse.next()

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie)
    })
    return response
  }

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (user && (
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname === '/signup' ||
    request.nextUrl.pathname === '/forgot-password'
  )) {
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
      url.search = ''
    } else {
      url.pathname = '/dashboard'
      url.search = ''
    }
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Sign-up gate (NEXT_PUBLIC_SIGNUP_MODE, default "closed"). A private
  // marketing CRM should not hand out logins to whoever finds the URL,
  // so /signup bounces to /login unless the mode allows it. An invite
  // token rides along so the visitor can sign in and accept it.
  if (request.nextUrl.pathname === '/signup') {
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (!isSignupAllowed(getSignupMode(), inviteToken)) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ''
      return withRefreshedCookies(NextResponse.redirect(url))
    }
  }

  // Protected pages - redirect to login if not authenticated
  // Every top-level route under src/app/(dashboard)/ belongs here —
  // middleware.test.ts reads that directory and fails on a missing one.
  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/flows', '/agents', '/notifications', '/settings', '/help']
  if (!user && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // API routes that need auth (not webhooks)
  if (!user && request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
      !request.nextUrl.pathname.includes('/webhook')) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
  }

  return supabaseResponse
}

export const config = {
  // Every path, static assets included, so the site gate covers them.
  matcher: ['/', '/(.*)'],
}
