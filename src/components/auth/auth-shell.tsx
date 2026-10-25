import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { BRAND_COMPANY, BRAND_NAME } from "@/lib/brand";

/**
 * Sign-in / sign-up / reset frame. Left: the brand on the ink rail
 * colour, with the promise in Tamil and English (the team's two
 * working languages). Right: the form, nothing else.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-sidebar text-sidebar-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="flex items-center gap-3">
          <BrandMark className="size-9 text-sidebar-primary" />
          <span className="font-heading text-xl font-semibold tracking-tight">{BRAND_NAME}</span>
        </div>

        <div className="relative z-10 max-w-md">
          <p lang="ta" className="font-heading text-[2.5rem] font-semibold leading-[1.2] tracking-tight text-balance">
            ஒவ்வொரு <span className="whitespace-nowrap">customer-உம்,</span> ஒரே{" "}
            <span className="whitespace-nowrap">inbox-ல்.</span>
          </p>
          <p className="mt-4 text-lg text-sidebar-foreground/70">
            Every chat, campaign and lead for all your apps — answered by the whole team from one WhatsApp number.
          </p>
        </div>

        <p className="relative z-10 text-sm text-sidebar-foreground/50">{BRAND_COMPANY}</p>

        {/* One large, quiet drop mark bleeding off the corner. */}
        <BrandMark dot={false} className="pointer-events-none absolute -bottom-24 -right-24 size-[26rem] text-sidebar-accent opacity-60" />
      </aside>

      <main className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 flex items-center gap-2.5 lg:hidden">
            <BrandMark className="size-8 text-primary" />
            <span className="font-heading text-lg font-semibold tracking-tight text-foreground">{BRAND_NAME}</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
