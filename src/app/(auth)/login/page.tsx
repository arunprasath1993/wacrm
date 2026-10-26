"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UsersRound } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { getSignupMode, isSignupAllowed } from "@/lib/auth/signup-mode";

// `useSearchParams` opts the component out of static prerendering
// unless it sits under a Suspense boundary. We split the form into
// a child component so the outer page can prerender the chrome
// (background, card frame) while the form hydrates with the query
// string on the client.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  // Forwarded from `/join/<token>` when the visitor already has an
  // account. After a successful sign-in we send them to the join
  // page to accept rather than to /dashboard.
  const inviteToken = searchParams.get("invite");
  const t = useTranslations("LoginPage");
  // Set by /auth/callback when an emailed link (confirmation, password
  // reset) could not be turned into a session — see src/lib/auth/callback.ts.
  const linkError = searchParams.get("error");
  const linkErrorMessage =
    linkError === "link_expired"
      ? t("linkExpired")
      : linkError === "link_invalid"
        ? t("linkInvalid")
        : null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Full-page navigation (not router.push) so the browser issues a
    // fresh top-level request that carries the just-written Supabase
    // auth cookies to the middleware gating /dashboard. A soft
    // client-side navigation can reach the protected route before the
    // server observes the new session, so the middleware bounces it
    // back to /login — which looks like the page "just refreshing"
    // instead of signing in (issue #365). Mirrors the deliberate full
    // reload the invite-accept flow already uses in join/[token].
    const destination = inviteToken
      ? `/join/${encodeURIComponent(inviteToken)}`
      : "/dashboard";
    window.location.href = destination;
  };

  const signupMode = getSignupMode();
  const canSignUp = isSignupAllowed(signupMode, inviteToken);

  return (
    <AuthShell>
      <div className="mb-8">
        {inviteToken && (
          <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <UsersRound className="size-5" />
          </span>
        )}
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
          {inviteToken ? t("titleAccept") : t("titleWelcome")}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {inviteToken ? t("descAccept") : t("descWelcome")}
        </p>
      </div>

      <form onSubmit={handleLogin} className="flex flex-col gap-5">
        {linkErrorMessage && !error && (
          <div role="status" className="rounded-lg border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-sm text-foreground">
            {linkErrorMessage}
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-foreground">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="email">{t("emailLabel")}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-11 bg-card"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t("passwordLabel")}</Label>
            <Link href="/forgot-password" className="text-sm text-primary hover:underline">
              {t("forgotPassword")}
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder={t("passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="h-11 bg-card"
          />
        </div>

        <Button type="submit" disabled={loading} className="mt-1 h-11 w-full text-base">
          {loading ? t("signingIn") : t("signIn")}
        </Button>
      </form>

      {canSignUp ? (
        <p className="mt-8 text-sm text-muted-foreground">
          {t("noAccount")}{" "}
          <Link
            href={inviteToken ? `/signup?invite=${encodeURIComponent(inviteToken)}` : "/signup"}
            className="text-primary hover:underline"
          >
            {t("createAccount")}
          </Link>
        </p>
      ) : (
        <p className="mt-8 max-w-[44ch] text-sm text-muted-foreground">{t("privateHint")}</p>
      )}
    </AuthShell>
  );
}
