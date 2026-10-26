"use client";

import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { useApps } from "@/hooks/use-apps";
import { ALL_APPS } from "@/lib/apps/apps";
import { cn } from "@/lib/utils";
import { AppMark } from "./app-badge";

/**
 * Says out loud that a list is scoped to one app, with a one-click way
 * back to everything — so a short list never reads as "data missing".
 * Renders nothing in the All apps view.
 */
export function ActiveAppNotice({ className }: { className?: string }) {
  const t = useTranslations("Apps");
  const { activeApp, setActiveAppId } = useApps();
  if (!activeApp) return null;
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border py-1 pl-1 pr-1.5 text-sm text-foreground",
        className,
      )}
      style={{
        borderColor: `${activeApp.color}66`,
        backgroundColor: `${activeApp.color}14`,
      }}
    >
      <AppMark app={activeApp} size={20} />
      <span>{t("filterChip", { name: activeApp.name })}</span>
      <button
        type="button"
        onClick={() => setActiveAppId(ALL_APPS)}
        className="ml-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-background/60 hover:text-foreground"
      >
        <X className="size-3.5" />
        {t("showAll")}
      </button>
    </div>
  );
}
