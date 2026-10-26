"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHelpLang } from "@/hooks/use-help-lang";
import { guideById, HELP_GUIDES, pick, searchGuides } from "@/lib/help/guides";
import type { HelpGuide } from "@/lib/help/types";
import { GuideView } from "@/components/help/guide-view";
import { HelpLangToggle } from "@/components/help/help-lang-toggle";

const COPY = {
  title: { en: "Help & guides", ta: "உதவி & வழிகாட்டிகள்" },
  intro: {
    en: "How each page works, step by step. The ? button in the top bar opens the guide for the page you're on.",
    ta: "ஒவ்வொரு page-ம் எப்படி வேலை செய்கிறது — படிப்படியாக. மேலே உள்ள ? button நீங்கள் இருக்கும் page-ன் guide-ஐ திறக்கும்.",
  },
  search: { en: "Search guides", ta: "Guides-ல் தேடுங்கள்" },
  noResults: { en: "No guide mentions that. Try another word.", ta: "அந்த வார்த்தை எந்த guide-லும் இல்லை. வேறு வார்த்தையில் தேடுங்கள்." },
  groups: {
    start: { en: "Start here", ta: "இங்கே தொடங்குங்கள்" },
    conversations: { en: "Conversations", ta: "உரையாடல்கள்" },
    customers: { en: "Customers", ta: "வாடிக்கையாளர்கள்" },
    campaigns: { en: "Campaigns & automation", ta: "Campaigns & automation" },
    setup: { en: "Setup", ta: "Setup" },
  },
} as const;

const GROUP_ORDER: HelpGuide["group"][] = ["start", "conversations", "customers", "campaigns", "setup"];

export default function HelpPage() {
  return (
    <Suspense fallback={null}>
      <HelpPageInner />
    </Suspense>
  );
}

function HelpPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [lang, setLang] = useHelpLang();
  const [query, setQuery] = useState("");

  const selected = guideById(params.get("g") ?? "") ?? HELP_GUIDES[0];
  const results = useMemo(() => searchGuides(query), [query]);

  const select = (id: string) => {
    router.replace(`/help?g=${id}`, { scroll: false });
    document.getElementById("guide-top")?.scrollIntoView({ block: "start" });
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div lang={lang}>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">{pick(COPY.title, lang)}</h1>
          <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">{pick(COPY.intro, lang)}</p>
        </div>
        <HelpLangToggle value={lang} onChange={setLang} className="self-start sm:self-auto" />
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
        <aside className="lg:sticky lg:top-0">
          <label className="relative block">
            <span className="sr-only">{pick(COPY.search, lang)}</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={pick(COPY.search, lang)}
              lang={lang}
              className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </label>

          <nav aria-label={pick(COPY.title, lang)} className="mt-4" lang={lang}>
            {results.length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">{pick(COPY.noResults, lang)}</p>
            ) : (
              GROUP_ORDER.map((group) => {
                const items = results.filter((g) => g.group === group);
                if (items.length === 0) return null;
                return (
                  <div key={group} className="mb-4">
                    <p className="mb-1 px-3 text-xs font-medium text-muted-foreground">
                      {pick(COPY.groups[group], lang)}
                    </p>
                    <ul className="flex flex-col gap-0.5">
                      {items.map((g) => (
                        <li key={g.id}>
                          <button
                            type="button"
                            onClick={() => select(g.id)}
                            aria-current={g.id === selected.id ? "page" : undefined}
                            className={cn(
                              "w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                              g.id === selected.id
                                ? "bg-primary-soft font-medium text-foreground"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                          >
                            {pick(g.title, lang)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </nav>
        </aside>

        <div id="guide-top" className="min-w-0 scroll-mt-4 rounded-2xl border border-border bg-card p-5 sm:p-8">
          <GuideView guide={selected} lang={lang} />
        </div>
      </div>
    </div>
  );
}
