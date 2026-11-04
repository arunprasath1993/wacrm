"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CircleHelp, X } from "lucide-react";
import { useHelpLang } from "@/hooks/use-help-lang";
import { guideForPath } from "@/lib/help/guides";
import type { HelpGuide } from "@/lib/help/types";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { GuideView } from "./guide-view";
import { HelpLangToggle } from "./help-lang-toggle";

const LABEL = { en: "Help for this page", ta: "இந்த page-க்கான உதவி" };
const ALL = { en: "All guides", ta: "எல்லா guides" };

/**
 * Header "?" button: opens the guide for whatever page you're on, in
 * Tamil or English, without leaving the page.
 */
export function HelpButton() {
  const pathname = usePathname();
  const [lang, setLang] = useHelpLang();
  const [open, setOpen] = useState(false);
  const [guide, setGuide] = useState<HelpGuide>(() => guideForPath(pathname));

  const openHelp = () => {
    // Read ?tab= at click time instead of useSearchParams, so the
    // header never forces a Suspense boundary onto every page.
    const tab = new URLSearchParams(window.location.search).get("tab");
    setGuide(guideForPath(pathname, tab));
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={openHelp}
        aria-label={`${LABEL.en} / ${LABEL.ta}`}
        title={LABEL[lang]}
        className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <CircleHelp className="h-5 w-5" />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-md"
        >
          <SheetHeader className="sticky top-0 z-10 flex-row items-center gap-3 border-b border-border bg-popover px-5 py-3">
            <SheetTitle className="sr-only">{LABEL[lang]}</SheetTitle>
            <SheetDescription className="sr-only">{guide.summary[lang]}</SheetDescription>
            <HelpLangToggle value={lang} onChange={setLang} />
            <Link
              href={`/help?g=${guide.id}`}
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <BookOpen className="size-4" />
              <span lang={lang}>{ALL[lang]}</span>
            </Link>
            <SheetClose
              aria-label="Close / மூடு"
              className="ml-auto flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </SheetClose>
          </SheetHeader>
          <div className="px-5 py-5">
            <GuideView
              guide={guide}
              lang={lang}
              compact
              relatedHref={(id) => `/help?g=${id}`}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
