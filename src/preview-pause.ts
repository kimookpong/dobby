import { useSyncExternalStore } from "react";

/**
 * While a broadcast output is connected, the operator preview is a second copy of
 * the same Live2D render. It pauses by default; the operator can choose to keep it.
 */
const KEY = "dobby.previewWhileOutput";
let keep = (() => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();

export function setKeepPreview(value: boolean) {
  keep = value;
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    /* Preference only; fine to lose. */
  }
  for (const listener of listeners) listener();
}

export function useKeepPreview() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => keep,
  );
}
