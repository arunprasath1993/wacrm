import { cn } from "@/lib/utils";

/**
 * Brand mark: a water drop whose tail turns into a chat bubble's —
 * Nixie (water) meets WhatsApp (conversation). Pure SVG, inherits
 * colour from `currentColor` for the drop and `--signal` for the dot.
 */
export function BrandMark({
  className,
  title,
  dot = true,
}: {
  className?: string;
  title?: string;
  /** The turmeric "message" dot; off for large decorative use. */
  dot?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-8", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M16 3.2c4.6 5.5 9.6 10.6 9.6 16.1A9.6 9.6 0 0 1 12.3 28l-5.6 1.5 1.6-5A9.5 9.5 0 0 1 6.4 19.3C6.4 13.8 11.4 8.7 16 3.2Z"
        fill="currentColor"
      />
      {dot ? <circle cx="19.6" cy="18.6" r="2.6" fill="var(--signal)" /> : null}
    </svg>
  );
}
