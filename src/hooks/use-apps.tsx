"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  ACTIVE_APP_STORAGE_KEY,
  ALL_APPS,
  resolveActiveAppId,
} from "@/lib/apps/apps";
import type { CrmApp } from "@/types";

interface AppsContextValue {
  /** Live (non-archived) apps, in display order. */
  apps: CrmApp[];
  /** Every app including archived ones (Settings → Apps needs these). */
  allApps: CrmApp[];
  loading: boolean;
  /** The app the user is working on, or null for "All apps". */
  activeApp: CrmApp | null;
  setActiveAppId: (id: string) => void;
  refresh: () => Promise<void>;
  /** Tag that marks membership of the active app (null = no filter). */
  activeTagId: string | null;
}

const AppsContext = createContext<AppsContextValue | null>(null);

function readStored(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_APP_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string) {
  try {
    window.localStorage.setItem(ACTIVE_APP_STORAGE_KEY, id);
  } catch {
    // Private mode / blocked storage: the switcher still works for
    // this tab, it just won't be remembered.
  }
}

export function AppsProvider({ children }: { children: ReactNode }) {
  const { accountId } = useAuth();
  const [allApps, setAllApps] = useState<CrmApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string>(ALL_APPS);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("crm_apps")
      .select("*")
      .eq("account_id", accountId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    // A missing table (migration 060 not applied yet) must not break
    // the shell — the app simply behaves as "All apps".
    const rows = error ? [] : ((data ?? []) as CrmApp[]);
    setAllApps(rows);
    setActiveId(resolveActiveAppId(rows, readStored()));
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    // Async fetch — state lands after the awaited query.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  // Keep several open tabs in step when the user switches app.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACTIVE_APP_STORAGE_KEY) {
        setActiveId(resolveActiveAppId(allApps, e.newValue));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [allApps]);

  const setActiveAppId = useCallback(
    (id: string) => {
      const next = resolveActiveAppId(allApps, id);
      setActiveId(next);
      writeStored(next);
    },
    [allApps],
  );

  const value = useMemo<AppsContextValue>(() => {
    const apps = allApps.filter((a) => !a.archived_at);
    const activeApp = apps.find((a) => a.id === activeId) ?? null;
    return {
      apps,
      allApps,
      loading,
      activeApp,
      setActiveAppId,
      refresh,
      activeTagId: activeApp?.tag_id ?? null,
    };
  }, [allApps, loading, activeId, setActiveAppId, refresh]);

  return <AppsContext.Provider value={value}>{children}</AppsContext.Provider>;
}

const EMPTY: AppsContextValue = {
  apps: [],
  allApps: [],
  loading: false,
  activeApp: null,
  setActiveAppId: () => {},
  refresh: async () => {},
  activeTagId: null,
};

/** Safe outside the provider (returns an empty, "All apps" state). */
export function useApps(): AppsContextValue {
  return useContext(AppsContext) ?? EMPTY;
}
