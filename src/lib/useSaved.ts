"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "afrinext:saved";

let cache: string[] = [];
let snapshot = "[]";
const listeners = new Set<() => void>();

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY) ?? "[]";
    if (raw !== snapshot) {
      const parsed: unknown = JSON.parse(raw);
      cache = Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
      snapshot = raw;
    }
  } catch {
    cache = [];
    snapshot = "[]";
  }
  return cache;
}

function write(ids: string[]) {
  cache = ids;
  snapshot = JSON.stringify(ids);
  try {
    window.localStorage.setItem(KEY, snapshot);
  } catch {
    // Private browsing or a full quota: keep the in-memory value.
  }
  listeners.forEach((fn) => fn());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useSavedIds(): string[] {
  return useSyncExternalStore(subscribe, read, () => cache);
}

export function useSaved(id: string) {
  const ids = useSavedIds();
  const saved = ids.includes(id);

  const toggle = useCallback(() => {
    const current = read();
    write(
      current.includes(id)
        ? current.filter((v) => v !== id)
        : [id, ...current],
    );
  }, [id]);

  return { saved, toggle };
}

/** True once the client has hydrated, so saved state never flashes on SSR. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
