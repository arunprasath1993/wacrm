export const HELP_LANGS = ["ta", "en"] as const;
export type HelpLang = (typeof HELP_LANGS)[number];

/** One string in both languages. */
export interface Bi {
  en: string;
  ta: string;
}

export interface HelpSection {
  heading: Bi;
  /** Short paragraph before any steps. */
  body?: Bi;
  /** Ordered steps — only when the content really is a sequence. */
  steps?: Bi[];
  /** Unordered points (features, rules, options). */
  points?: Bi[];
  /** One highlighted tip or warning at the end of the section. */
  tip?: Bi;
}

export interface HelpGuide {
  id: string;
  /** Route prefix this guide documents; null for topic guides. */
  route: string | null;
  group: "start" | "conversations" | "customers" | "campaigns" | "setup";
  title: Bi;
  summary: Bi;
  sections: HelpSection[];
  /** Other guide ids worth reading next. */
  related?: string[];
}

export const HELP_LANG_STORAGE_KEY = "nixie-wa.help-lang";
export const DEFAULT_HELP_LANG: HelpLang = "ta";

export function isHelpLang(value: unknown): value is HelpLang {
  return typeof value === "string" && (HELP_LANGS as readonly string[]).includes(value);
}
