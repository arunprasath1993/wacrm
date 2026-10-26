/**
 * Who may create a new login on this deployment.
 *
 *   closed  (default) — nobody signs up from the app. The owner creates
 *                       teammates in Supabase (Authentication → Users →
 *                       Add user) and shares an invite link; the teammate
 *                       signs in and accepts it. Pair with "Allow new users
 *                       to sign up" switched OFF in Supabase so the public
 *                       anon key cannot be used to create logins either.
 *   invite            — /signup works only when it carries an invite token
 *                       (?invite=...). Supabase sign-ups must stay ON.
 *   open              — upstream behaviour: anyone can sign up and gets an
 *                       isolated, empty personal account.
 *
 * Read from NEXT_PUBLIC_SIGNUP_MODE so the server (middleware) and the
 * browser (login / join pages) agree. Inlined at build time — rebuild
 * after changing it.
 */
export const SIGNUP_MODES = ["closed", "invite", "open"] as const;

export type SignupMode = (typeof SIGNUP_MODES)[number];

export const DEFAULT_SIGNUP_MODE: SignupMode = "closed";

export function parseSignupMode(raw: string | undefined | null): SignupMode {
  const value = (raw ?? "").trim().toLowerCase();
  return (SIGNUP_MODES as readonly string[]).includes(value)
    ? (value as SignupMode)
    : DEFAULT_SIGNUP_MODE;
}

export function getSignupMode(): SignupMode {
  return parseSignupMode(process.env.NEXT_PUBLIC_SIGNUP_MODE);
}

/** Whether the /signup form may be shown for this visit. */
export function isSignupAllowed(
  mode: SignupMode,
  inviteToken: string | null | undefined,
): boolean {
  if (mode === "open") return true;
  if (mode === "invite") return !!inviteToken && inviteToken.trim().length > 0;
  return false;
}
