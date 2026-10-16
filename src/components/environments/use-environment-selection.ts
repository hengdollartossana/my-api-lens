"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The environment chosen for a project, remembered in localStorage and shared by the top bar,
 * the Run module panel and the endpoint screen (they all update together, also across tabs).
 */
const listeners = new Set<() => void>();
const key = (projectId: string) => `apilens-env:${projectId}`;

function read(projectId: string | null): string | null {
  if (!projectId) return null;
  try {
    return localStorage.getItem(key(projectId));
  } catch {
    return null;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function useEnvironmentSelection<T extends { id: string; isProd: boolean }>(
  projectId: string | null,
  environments: T[],
): [T | undefined, (id: string) => void] {
  const stored = useSyncExternalStore(
    subscribe,
    () => read(projectId),
    () => null,
  );
  const selected =
    environments.find((e) => e.id === stored) ??
    environments.find((e) => !e.isProd) ??
    environments[0];

  const select = useCallback(
    (id: string) => {
      if (!projectId) return;
      try {
        localStorage.setItem(key(projectId), id);
      } catch {
        // storage unavailable: selection just is not remembered
      }
      for (const l of listeners) l();
    },
    [projectId],
  );
  return [selected, select];
}
