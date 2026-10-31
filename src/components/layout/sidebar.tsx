"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import {
  Bell,
  Bot,
  CalendarClock,
  CircleHelp,
  Crown,
  GitBranch,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Radio,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  UsersRound,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";
import { BrandMark } from "@/components/brand/brand-mark";
import { BRAND_NAME } from "@/lib/brand";

// Per-role chip metadata used in the sidebar's account strip + the
// Members tab roster. Keeping this near both consumers in a single
// place avoids drift between the two surfaces — when a designer
// wants to recolour "agent" rows, this is the one diff.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: "roleOwner",
    // Amber: scarce, immutable, "the boss" — gets visual emphasis.
    className:
      "border-signal/40 bg-signal-soft text-signal",
  },
  admin: {
    icon: Shield,
    labelKey: "roleAdmin",
    // Primary-tinted: significant but not as scarce as owner.
    className:
      "border-sidebar-primary/40 bg-sidebar-primary/10 text-sidebar-primary",
  },
  agent: {
    icon: UserCog,
    labelKey: "roleAgent",
    // Neutral slate: the operational default.
    className:
      "border-sidebar-border bg-sidebar-accent text-sidebar-foreground",
  },
  viewer: {
    icon: User,
    labelKey: "roleViewer",
    // Muted slate: read-only role; visually quieter than agent.
    className:
      "border-sidebar-border bg-transparent text-sidebar-foreground/70",
  },
};
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  /**
   * When true, the nav row renders a small "Beta" chip after the label.
   * Purely informational — doesn't affect routing or access.
   */
  beta?: boolean;
}

/**
 * Navigation grouped by the job at hand: answering people, knowing
 * them, and reaching them at scale. Group labels are real structure
 * (they name the job), not decoration.
 */
const navGroups: { labelKey: string | null; items: NavItem[] }[] = [
  {
    labelKey: null,
    items: [{ href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard }],
  },
  {
    labelKey: "groupConversations",
    items: [
      { href: "/inbox", labelKey: "inbox", icon: MessageSquare },
      { href: "/notifications", labelKey: "notifications", icon: Bell },
    ],
  },
  {
    labelKey: "groupCustomers",
    items: [
      { href: "/contacts", labelKey: "contacts", icon: Users },
      { href: "/bookings", labelKey: "bookings", icon: CalendarClock },
      { href: "/pipelines", labelKey: "pipelines", icon: GitBranch },
    ],
  },
  {
    labelKey: "groupCampaigns",
    items: [
      { href: "/broadcasts", labelKey: "broadcasts", icon: Radio },
      { href: "/automations", labelKey: "automations", icon: Zap },
      { href: "/flows", labelKey: "flows", icon: Workflow, beta: true },
      { href: "/agents", labelKey: "aiAgents", icon: Bot },
    ],
  },
];

const bottomNavItems: NavItem[] = [
  { href: "/help", labelKey: "help", icon: CircleHelp },
  { href: "/settings", labelKey: "settings", icon: Settings },
];

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

import { useTranslations } from "next-intl";

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const { profile, profileLoading, account, accountRole, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  // Only surface the account-name strip when it actually carries
  // information. A solo user's personal account is named after them
  // (the 017 signup trigger seeds it from `full_name`), so showing it
  // here would just duplicate the user name in the footer below. Once
  // the account is renamed or the user joins a shared account, the
  // name diverges and the strip becomes meaningful — that's the signal
  // we gate on. Wait for the profile fetch to settle first, otherwise
  // the strip flashes in once the row resolves (a layout jump).
  const showAccountStrip =
    !profileLoading &&
    !!account?.name &&
    account.name !== profile?.full_name;

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const renderItem = (item: NavItem) => {
    const isActive =
      pathname === item.href ||
      (item.href !== "/dashboard" && pathname.startsWith(item.href));

    const showUnreadDot =
      item.href === "/inbox" && totalUnread > 0 && !isActive;

    // Unlike the inbox dot, the notifications count stays visible
    // even while the page is active — it reflects unread state
    // (cleared by marking notifications read), not "currently
    // viewing this section".
    const showNotificationBadge =
      item.href === "/notifications" && unreadNotifications > 0;

    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={isActive ? "page" : undefined}
          className={cn(
            // Taller on mobile so fingers can hit the row reliably (≥44px).
            "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[0.9rem] font-medium transition-colors lg:py-2",
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
          )}
        >
          {/* Active marker: a short bar in the accent, flush left. */}
          <span
            aria-hidden
            className={cn(
              "absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-sidebar-primary transition-opacity",
              isActive ? "opacity-100" : "opacity-0",
            )}
          />
          <item.icon
            className={cn(
              "h-[18px] w-[18px] shrink-0",
              isActive ? "text-sidebar-primary" : "text-sidebar-foreground/55 group-hover:text-sidebar-foreground/80",
            )}
          />
          <span className="flex-1 truncate">{t(item.labelKey as string)}</span>
          {item.beta && (
            <span
              aria-label={t("beta")}
              className="rounded-md border border-sidebar-border px-1.5 py-px text-[10px] font-medium text-sidebar-foreground/60"
            >
              {t("beta")}
            </span>
          )}
          {showUnreadDot && (
            <span
              aria-label={t("unreadConversations", { count: totalUnread })}
              className="relative flex h-2 w-2"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
            </span>
          )}
          {showNotificationBadge && (
            <span
              aria-label={t("unreadNotifications", { count: unreadNotifications })}
              className="flex h-5 min-w-5 items-center justify-center rounded-full bg-signal px-1 text-[10px] font-semibold text-signal-foreground"
            >
              {unreadNotifications > 9 ? "9+" : unreadNotifications}
            </span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. Clicking
          it closes the drawer. Hidden from lg+ since the sidebar is
          part of the main flex row there. */}
      <button
        type="button"
        aria-label={t("closeMenu")}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-background/70 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          "fixed inset-y-0 left-0 z-40 flex h-full w-[17rem] flex-col bg-sidebar text-sidebar-foreground",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, always visible — reset all the mobile framing.
          "lg:static lg:z-0 lg:w-64 lg:translate-x-0 lg:transition-none",
        )}
        aria-label={t("primaryNav")}
      >
        {/* Brand row. On mobile a close button sits here too. */}
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-5">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-offset-4">
            <BrandMark className="size-7 shrink-0 text-sidebar-primary" />
            <span className="truncate font-heading text-[1.05rem] font-semibold tracking-tight text-sidebar-foreground">
              {BRAND_NAME}
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeMenu")}
            className="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Main navigation */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-1">
          {navGroups.map((group, gi) => (
            <div key={group.labelKey ?? `g${gi}`} className={gi > 0 ? "mt-5" : undefined}>
              {group.labelKey ? (
                <p className="mb-1.5 px-3 text-xs font-medium text-sidebar-foreground/45">
                  {t(group.labelKey)}
                </p>
              ) : null}
              <ul className="flex flex-col gap-0.5">{group.items.map(renderItem)}</ul>
            </div>
          ))}

          <div className="my-5 border-t border-sidebar-border" />

          <ul className="flex flex-col gap-0.5">{bottomNavItems.map(renderItem)}</ul>
        </nav>

        {/* User section */}
        <div className="shrink-0 border-t border-sidebar-border p-3">
          {/* Account name display — surfaced only when the account
              name differs from the user's own name (see
              `showAccountStrip`). */}
          {showAccountStrip && account?.name ? (
            <div className="mb-2 flex items-center gap-2 px-3 text-xs text-sidebar-foreground/60">
              <UsersRound className="size-3.5 shrink-0" />
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
              {accountRole ? (
                (() => {
                  const meta = ROLE_CHIP[accountRole];
                  const Icon = meta.icon;
                  return (
                    <span
                      className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.className}`}
                    >
                      <Icon className="size-3" />
                      {t(meta.labelKey as string)}
                    </span>
                  );
                })()
              ) : null}
            </div>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sidebar-accent focus:bg-sidebar-accent focus:outline-none data-popup-open:bg-sidebar-accent">
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? t("defaultAvatar")}
                  />
                ) : null}
                <AvatarFallback className="bg-sidebar-primary/15 text-sm font-semibold text-sidebar-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-sidebar-foreground">
                  {profile?.full_name ?? t("defaultUser")}
                </p>
                <p className="truncate text-xs text-sidebar-foreground/55">
                  {profile?.email ?? ""}
                </p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-56 bg-popover text-popover-foreground ring-border"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <User className="size-4" />
                {t("menuProfile")}
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=whatsapp"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <Settings className="size-4" />
                {t("menuSettings")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <LogOut className="size-4" />
                {t("menuSignOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
