import Link from "next/link";
import { Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { guideById, pick } from "@/lib/help/guides";
import type { HelpGuide, HelpLang } from "@/lib/help/types";

const RELATED_LABEL = { en: "Read next", ta: "அடுத்து படிக்க" };

/** Renders one help guide in the chosen language. */
export function GuideView({
  guide,
  lang,
  compact = false,
  relatedHref = (id: string) => `/help?g=${id}`,
}: {
  guide: HelpGuide;
  lang: HelpLang;
  /** Drawer layout: tighter spacing, smaller title. */
  compact?: boolean;
  relatedHref?: (id: string) => string;
}) {
  return (
    <article lang={lang} className={cn("text-foreground", lang === "ta" && "leading-relaxed")}>
      <header className={compact ? "mb-4" : "mb-6"}>
        <h2 className={cn("font-heading font-semibold tracking-tight", compact ? "text-xl" : "text-2xl sm:text-3xl")}>
          {pick(guide.title, lang)}
        </h2>
        <p className="mt-1.5 max-w-[62ch] text-[0.95rem] text-muted-foreground">{pick(guide.summary, lang)}</p>
      </header>

      <div className={cn("flex flex-col", compact ? "gap-5" : "gap-7")}>
        {guide.sections.map((section, i) => (
          <section key={i}>
            <h3 className="font-heading text-base font-semibold">{pick(section.heading, lang)}</h3>
            {section.body && (
              <p className="mt-1.5 max-w-[68ch] text-[0.95rem] text-muted-foreground">{pick(section.body, lang)}</p>
            )}
            {section.steps && (
              <ol className="mt-3 flex flex-col gap-2.5">
                {section.steps.map((step, j) => (
                  <li key={j} className="flex gap-3 text-[0.95rem]">
                    <span
                      aria-hidden
                      className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft font-heading text-xs font-semibold text-primary"
                    >
                      {j + 1}
                    </span>
                    <span className="max-w-[64ch]">{pick(step, lang)}</span>
                  </li>
                ))}
              </ol>
            )}
            {section.points && (
              <ul className="mt-3 flex flex-col gap-2">
                {section.points.map((point, j) => (
                  <li key={j} className="flex gap-3 text-[0.95rem]">
                    <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-primary" />
                    <span className="max-w-[64ch]">{pick(point, lang)}</span>
                  </li>
                ))}
              </ul>
            )}
            {section.tip && (
              <p className="mt-3 flex max-w-[68ch] gap-2.5 rounded-lg border-l-[3px] border-signal bg-signal-soft px-3 py-2.5 text-sm">
                <Lightbulb aria-hidden className="mt-0.5 size-4 shrink-0 text-signal" />
                <span>{pick(section.tip, lang)}</span>
              </p>
            )}
          </section>
        ))}
      </div>

      {guide.related && guide.related.length > 0 && (
        <nav className={cn("border-t border-border pt-4", compact ? "mt-6" : "mt-10")}>
          <p className="mb-2 text-sm text-muted-foreground">{pick(RELATED_LABEL, lang)}</p>
          <ul className="flex flex-wrap gap-2">
            {guide.related.map((id) => {
              const g = guideById(id);
              if (!g) return null;
              return (
                <li key={id}>
                  <Link
                    href={relatedHref(id)}
                    className="inline-flex rounded-lg border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary hover:bg-primary-soft"
                  >
                    {pick(g.title, lang)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </article>
  );
}
