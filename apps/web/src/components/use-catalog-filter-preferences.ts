"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

const temporaryPreferences = new Map<string, string>();

function readPreference(key: string) {
  if (temporaryPreferences.has(key)) return temporaryPreferences.get(key);
  try { return localStorage.getItem(key); } catch { return null; }
}

function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    temporaryPreferences.delete(key);
  } catch {
    temporaryPreferences.set(key, value);
  }
}

export function useCatalogFilterPreferences<T extends Record<string, string | boolean | number>>(
  key: string, defaults: T, read: (saved: Partial<T>) => T,
) {
  const [stored, setStored] = useState<{ key: string; value: T }>();
  const latest = useRef<typeof stored>(undefined);
  useEffect(() => {
    let value = defaults;
    try { value = read(JSON.parse(readPreference(key) ?? "{}") ?? {}); }
    catch { /* Start with the defaults if the stored value is corrupt. */ }
    latest.current = { key, value };
    setStored(latest.current);
  }, [key, defaults, read]);

  function changeFilters(patch: Partial<T>) {
    const value = { ...(latest.current?.key === key ? latest.current.value : defaults), ...patch };
    latest.current = { key, value };
    savePreference(key, JSON.stringify(value));
    setStored(latest.current);
  }
  return { filters: stored?.key === key ? stored.value : defaults, changeFilters, ready: stored?.key === key };
}

function filterParams(source: URLSearchParams, keys: readonly string[]) {
  const result = new URLSearchParams();
  for (const key of keys) {
    const value = source.get(key);
    if (value !== null) result.set(key, value);
  }
  return result;
}

export function useCatalogFilterUrl(key: string, keys: readonly string[], active = true) {
  const search = useSearchParams();
  const searchText = search.toString();
  const [readyKey, setReadyKey] = useState("");

  useEffect(() => {
    if (!active) return;
    const url = new URL(window.location.href);
    // The address bar can already be ahead of the App Router snapshot.
    if (url.searchParams.toString() !== searchText) return;
    const explicit = filterParams(url.searchParams, keys);
    if (explicit.size) {
      savePreference(key, explicit.toString());
    } else {
      const saved = filterParams(new URLSearchParams(readPreference(key) ?? ""), keys);
      if (saved.size) {
        for (const [name, value] of saved) url.searchParams.set(name, value);
        window.history.replaceState(null, "", url);
        return;
      }
    }
    setReadyKey(key);
  }, [active, key, keys, searchText]);

  function rememberUrlFilters(patch: Record<string, string | null>) {
    const url = new URL(window.location.href);
    for (const [name, value] of Object.entries(patch)) {
      if (value) url.searchParams.set(name, value);
      else url.searchParams.delete(name);
    }
    savePreference(key, filterParams(url.searchParams, keys).toString());
    return url;
  }

  function changeUrlFilters(patch: Record<string, string | null>, push = false) {
    const url = rememberUrlFilters(patch);
    if (url.href === window.location.href) return;
    if (push) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }

  return { search, changeUrlFilters, rememberUrlFilters, ready: !active || readyKey === key };
}
