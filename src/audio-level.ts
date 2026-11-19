import { useSyncExternalStore } from "react";

/**
 * Mouth-sync level lives outside React state: it changes ~20–60 times a second,
 * so Live2D reads it per frame and only tiny meter components subscribe.
 */
type Level = { level: number; active: boolean };
let current: Level = { level: 0, active: false };
const listeners = new Set<() => void>();
let notifyFrame = 0;

export const audioLevel = {
  get: () => current,
  set(level: number, active: boolean) {
    if (current.level === level && current.active === active) return;
    current = { level, active };
    // Coalesce UI notifications to one per animation frame.
    if (notifyFrame) return;
    notifyFrame = requestAnimationFrame(() => {
      notifyFrame = 0;
      for (const listener of listeners) listener();
    });
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useAudioLevel() {
  return useSyncExternalStore(audioLevel.subscribe, audioLevel.get);
}

/** Updates the local store every frame and the main process at most every 50ms. */
export function createAudioReporter() {
  let last = 0;
  return (level: number, active: boolean) => {
    audioLevel.set(level, active);
    const now = performance.now();
    if (!active || now - last > 50) {
      last = now;
      window.dobby.audio(level, active);
    }
  };
}
