"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, Layers, Settings2 } from "lucide-react";
import { useApps } from "@/hooks/use-apps";
import { ALL_APPS } from "@/lib/apps/apps";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AppMark } from "./app-badge";

/**
 * "Which product am I marketing right now?" — the one control that
 * scopes contacts, inbox, broadcasts and pipelines to an app. Lives in
 * the header so it is visible on every page.
 */
export function AppSwitcher({
  className,
  compact = false,
}: {
  className?: string;
  /** Mark-only trigger for narrow headers. */
  compact?: boolean;
}) {
  const t = useTranslations("Apps");
  const { apps, activeApp, setActiveAppId, loading } = useApps();

  if (loading) return null;

  if (apps.length === 0) {
    return (
      <Link
        href="/settings?tab=apps"
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground",
          className,
        )}
      >
        <Layers className="size-4" />
        <span className={compact ? "sr-only" : "hidden sm:inline"}>{t("addFirstApp")}</span>
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("switcherLabel")}
        className={cn(
          "inline-flex h-9 max-w-[16rem] items-center gap-2 rounded-lg border border-border bg-card px-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus:outline-none data-popup-open:bg-muted",
          className,
        )}
      >
        {activeApp ? (
          <AppMark app={activeApp} size={22} />
        ) : (
          <span className="inline-flex size-[22px] items-center justify-center rounded-[28%] bg-muted text-muted-foreground">
            <Layers className="size-3.5" />
          </span>
        )}
        <span className={compact ? "sr-only" : "truncate"}>
          {activeApp ? activeApp.name : t("allApps")}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="min-w-64 bg-popover text-popover-foreground ring-border"
      >
        <p className="px-2 pb-1.5 pt-1 text-xs text-muted-foreground">{t("switcherHint")}</p>
        <DropdownMenuItem
          onClick={() => setActiveAppId(ALL_APPS)}
          className="gap-2 text-popover-foreground focus:bg-accent focus:text-accent-foreground"
        >
          <span className="inline-flex size-5 items-center justify-center rounded-[28%] bg-muted text-muted-foreground">
            <Layers className="size-3" />
          </span>
          <span className="flex-1">{t("allApps")}</span>
          {!activeApp && <Check className="size-4 text-primary" />}
        </DropdownMenuItem>
        {apps.map((app) => (
          <DropdownMenuItem
            key={app.id}
            onClick={() => setActiveAppId(app.id)}
            className="gap-2 text-popover-foreground focus:bg-accent focus:text-accent-foreground"
          >
            <AppMark app={app} size={20} />
            <span className="flex-1 truncate">{app.name}</span>
            {activeApp?.id === app.id && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem
          render={
            <Link
              href="/settings?tab=apps"
              className="gap-2 text-popover-foreground focus:bg-accent focus:text-accent-foreground"
            />
          }
        >
          <Settings2 className="size-4" />
          {t("manageApps")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
