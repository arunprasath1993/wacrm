"use client";

import { cn } from "@/lib/utils";
import type { HelpLang } from "@/lib/help/types";

const OPTIONS: { value: HelpLang; label: string; lang: string }[] = [
  { value: "ta", label: "தமிழ்", lang: "ta" },
  { value: "en", label: "English", lang: "en" },
];

/** Segmented Tamil / English switch for help content. */
export function HelpLangToggle({
  value,
  onChange,
  className,
}: {
  value: HelpLang;
  onChange: (lang: HelpLang) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Help language / உதவி மொழி"
      className={cn("inline-flex rounded-lg border border-border bg-muted p-0.5", className)}
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          lang={o.lang}
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-3 py-1 text-sm font-medium transition-colors",
            value === o.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
