"use client";

import { useTranslations } from "next-intl";
import { BadgeCheck, Clock } from "lucide-react";
import { PROVIDERS, providerInfo } from "@/lib/whatsapp/providers/registry";
import { cn } from "@/lib/utils";

/**
 * Which WhatsApp API this account sends through. Meta Cloud API is
 * live; the BSPs are listed (disabled) so the team knows the CRM is
 * ready for them — see docs/whatsapp-providers.md for adding one.
 */
export function ProviderPicker({ current }: { current?: string | null }) {
  const t = useTranslations("Providers");
  const active = providerInfo(current);
  return (
    <section aria-labelledby="provider-heading" className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="provider-heading" className="text-sm font-semibold text-foreground">
          {t("title")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
      </div>
      <ul role="radiogroup" aria-labelledby="provider-heading" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {PROVIDERS.map((p) => {
          const selected = p.id === active.id;
          const available = p.status === "available";
          return (
            <li key={p.id}>
              <div
                role="radio"
                aria-checked={selected}
                aria-disabled={!available}
                className={cn(
                  "flex h-full flex-col gap-1 rounded-lg border px-3 py-2.5",
                  selected ? "border-primary bg-primary-soft" : "border-border",
                  !available && "opacity-60",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  {p.name}
                  {p.official && <BadgeCheck aria-label={t("official")} className="size-4 text-primary" />}
                </span>
                <span className="text-xs text-muted-foreground">{p.blurb}</span>
                <span
                  className={cn(
                    "mt-auto inline-flex items-center gap-1 pt-1 text-xs",
                    selected ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {selected ? (
                    t("inUse")
                  ) : available ? (
                    t("available")
                  ) : (
                    <>
                      <Clock className="size-3" />
                      {t("planned")}
                    </>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
