import { cn } from "@/lib/utils";
import { appMonogram, readableTextOn } from "@/lib/apps/apps";
import type { CrmApp } from "@/types";

/**
 * Square app mark: the app's emoji/icon if it has one, else its first
 * letter on the app colour. Sized by `size` (px) so it can sit in a
 * menu row, a table cell or a header.
 */
export function AppMark({
  app,
  size = 20,
  className,
}: {
  app: Pick<CrmApp, "name" | "color" | "icon">;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[28%] font-heading font-semibold leading-none",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: app.icon ? size * 0.62 : size * 0.52,
        backgroundColor: app.color,
        color: readableTextOn(app.color),
      }}
    >
      {app.icon || appMonogram(app.name)}
    </span>
  );
}

/** Mark + name, for lists and table rows. */
export function AppBadge({
  app,
  className,
}: {
  app: Pick<CrmApp, "name" | "color" | "icon">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card-2 py-0.5 pl-0.5 pr-2 text-xs font-medium text-foreground",
        className,
      )}
    >
      <AppMark app={app} size={16} />
      <span className="truncate">{app.name}</span>
    </span>
  );
}
