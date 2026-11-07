"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useNavigationBlocker } from "@/components/navigation";
import { apiMessage, productionApi } from "@/lib/production-api";
import {
  createPaper4SaveState,
  paper4SaveReducer,
  paper4SaveSummary,
} from "@/components/paper4/paper4-save-state";
import type { SchoolPaper4Attempt } from "./school-paper4-model";

/** Keep acknowledged server content separate from the editor buffer, including lost responses. */
export function useSchoolPaper4Save(
  base: string,
  attempt: SchoolPaper4Attempt,
  userId: string,
  frozen: boolean,
) {
  const initial = Object.fromEntries(
    Object.entries(attempt.files).map(([key, file]) => [key, file.code]),
  );
  const [codes, setCodes] = useState(initial),
    [state, dispatch] = useReducer(
      paper4SaveReducer,
      initial,
      createPaper4SaveState,
    );
  const latest = useRef(initial),
    saved = useRef(initial),
    revisions = useRef(
      Object.fromEntries(
        Object.entries(attempt.files).map(([key, file]) => [
          key,
          file.revision,
        ]),
      ),
    );
  const inflight = useRef(new Map<string, Promise<void>>()),
    alive = useRef(true);
  const storageKey = `campus:school-paper4:${userId}:${attempt.id}`;
  const [recovery, setRecovery] = useState<Record<string, string> | null>(null);
  const { dirty, status } = paper4SaveSummary(codes, state);
  useNavigationBlocker(dirty);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (frozen) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw || raw.length > 1_000_000) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      const valid = Object.fromEntries(
        Object.keys(latest.current)
          .filter(
            (key) =>
              typeof parsed[key] === "string" && parsed[key].length <= 262144,
          )
          .map((key) => [key, parsed[key]]),
      );
      if (Object.keys(valid).some((key) => valid[key] !== latest.current[key]))
        setRecovery(valid);
    } catch {
      /* Storage is optional. */
    }
  }, [storageKey, frozen]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const change = (key: string, code: string) => {
    if (frozen) return;
    latest.current = { ...latest.current, [key]: code };
    setCodes(latest.current);
    try {
      localStorage.setItem(storageKey, JSON.stringify(latest.current));
    } catch {
      /* Server autosave remains available. */
    }
  };
  const saveFile = useCallback(
    async function saveFile(key: string): Promise<void> {
      const current = inflight.current.get(key);
      if (current) {
        await current;
        if (latest.current[key] !== saved.current[key]) return saveFile(key);
        return;
      }
      let retry = Boolean(state.errors[key]);
      if (!retry && latest.current[key] === saved.current[key]) return;
      dispatch({ type: "start", key });
      const operation = (async () => {
        while (retry || latest.current[key] !== saved.current[key]) {
          const code = latest.current[key] ?? "";
          const response = await productionApi<{ revision: number }>(
            `${base}/attempts/${attempt.id}/files/${encodeURIComponent(key)}`,
            {
              method: "PUT",
              body: { code, expectedRevision: revisions.current[key] },
            },
          );
          if (!Number.isInteger(response.revision))
            throw new Error("The server did not confirm a code revision.");
          revisions.current[key] = response.revision;
          saved.current = { ...saved.current, [key]: code };
          retry = false;
          if (alive.current)
            dispatch({ type: "acknowledge", key, content: code });
        }
      })();
      inflight.current.set(key, operation);
      try {
        await operation;
      } catch (error) {
        if (alive.current)
          dispatch({ type: "fail", key, message: apiMessage(error) });
        throw error;
      } finally {
        inflight.current.delete(key);
        if (alive.current) dispatch({ type: "settle", key });
      }
    },
    [base, attempt.id, state.errors],
  );
  const saveAll = useCallback(async () => {
    await Promise.all(Object.keys(latest.current).map(saveFile));
    if (
      Object.keys(latest.current).every(
        (key) => latest.current[key] === saved.current[key],
      )
    )
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* Optional draft cache. */
      }
  }, [saveFile, storageKey]);
  useEffect(() => {
    if (frozen || !dirty || status === "error") return;
    const timer = setTimeout(() => void saveAll().catch(() => undefined), 900);
    return () => clearTimeout(timer);
  }, [codes, dirty, frozen, status, saveAll]);
  return {
    codes,
    change,
    saveAll,
    dirty,
    status,
    error: Object.values(state.errors)[0] ?? "",
    recovery,
    restore: () => {
      if (!recovery) return;
      latest.current = { ...latest.current, ...recovery };
      setCodes(latest.current);
      setRecovery(null);
    },
    discard: () => {
      setRecovery(null);
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* Optional draft cache. */
      }
    },
  };
}
