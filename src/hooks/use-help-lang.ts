"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_HELP_LANG,
  HELP_LANG_STORAGE_KEY,
  isHelpLang,
  type HelpLang,
} from "@/lib/help/types";

const EVENT = "nixie-wa:help-lang";

/** Help-guide language (Tamil / English), remembered per browser. */
export function useHelpLang(): [HelpLang, (lang: HelpLang) => void] {
  const [lang, setLangState] = useState<HelpLang>(DEFAULT_HELP_LANG);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(HELP_LANG_STORAGE_KEY);
      // Read after mount (not in useState) so server and first client
      // render agree; the saved choice applies one frame later.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (isHelpLang(saved)) setLangState(saved);
    } catch {
      /* storage blocked — keep default */
    }
    // Keep the drawer and the help page in step within one tab.
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<HelpLang>).detail;
      if (isHelpLang(next)) setLangState(next);
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  const setLang = useCallback((next: HelpLang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(HELP_LANG_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  }, []);

  return [lang, setLang];
}
