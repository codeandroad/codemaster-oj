"use client";

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { apiMessage, productionApi } from "@/lib/production-api";
import { createWorkspaceResourceStore, emptyWorkspaceResource } from "./workspace-resource-store";

type Store = ReturnType<typeof createWorkspaceResourceStore>;
const WorkspaceDataContext = createContext<Store | null>(null);
const serverSnapshot = () => emptyWorkspaceResource;

export function WorkspaceDataProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createWorkspaceResourceStore(
    (path, signal) => productionApi(path, { signal }),
    apiMessage,
  ));
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") store.refreshObserved();
    };
    const membershipsChanged = () => { void store.load("schools"); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("codemaster:schools-changed", membershipsChanged);
    window.addEventListener("codemaster:school-access-check", membershipsChanged);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("codemaster:schools-changed", membershipsChanged);
      window.removeEventListener("codemaster:school-access-check", membershipsChanged);
      store.clear();
    };
  }, [store]);
  return <WorkspaceDataContext.Provider value={store}>{children}</WorkspaceDataContext.Provider>;
}

/** Navigation metadata and catalog summaries only; never cache answers or workspaces. */
export function useWorkspaceData<T>(path: string) {
  const store = useContext(WorkspaceDataContext);
  if (!store) throw new Error("Workspace data requires an authenticated provider.");
  const subscribe = useCallback((listener: () => void) => store.subscribe(path, listener), [path, store]);
  const snapshot = useCallback(() => store.snapshot(path), [path, store]);
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => { void store.load(path); }, [path, store]);
  const reload = useCallback(() => { void store.load(path); }, [path, store]);
  return { ...state, data: state.data as T | null, reload };
}
