import type { ViewerStatus, WelcomeSettings } from "../src/shared";
import { speakableName } from "../src/viewer-name";

export type WelcomeBatch = { names: string[]; returning: string[]; others: number };

/**
 * Collects viewers who join, so the host can greet them together during a pause
 * ("ยินดีต้อนรับ A, B และอีก 3 คน") instead of once per join. O(1) per join event.
 */
export class WelcomeBatcher {
  private pending = new Map<string, { name: string | null; at: number; back: boolean }>();
  private greeted = new Map<string, number>();
  private lastWelcome = -Infinity;
  constructor(private now = Date.now) {}
  add(
    viewerId: string,
    displayName: string,
    settings: WelcomeSettings,
    status: ViewerStatus = "new",
  ) {
    if (!settings.enabled) return;
    const now = this.now();
    const greetedAt = this.greeted.get(viewerId);
    if (greetedAt !== undefined && now - greetedAt < settings.regreetMinutes * 60_000)
      return;
    if (this.pending.has(viewerId)) return;
    // Bounded under join storms: extra joiners only raise the "and N others" count.
    if (this.pending.size >= 200) {
      const oldest = this.pending.keys().next().value!;
      this.pending.delete(oldest);
    }
    this.pending.set(viewerId, {
      name: speakableName(displayName),
      at: now,
      back: status !== "new",
    });
  }
  /** Returns a batch when one is due; the caller only asks when the host is otherwise idle. */
  take(settings: WelcomeSettings): WelcomeBatch | null {
    if (!settings.enabled || !this.pending.size) return null;
    const now = this.now();
    if (now - this.lastWelcome < settings.intervalSeconds * 1000) return null;
    const oldest = this.pending.values().next().value!;
    // Wait briefly so joiners arriving together are greeted together.
    if (now - oldest.at < 3000) return null;
    const entries = [...this.pending.entries()];
    this.pending.clear();
    this.lastWelcome = now;
    const names: string[] = [];
    const returning: string[] = [];
    // Returning viewers are named first: being recognised is what makes them stay.
    const ordered = [...entries].sort((a, b) => Number(b[1].back) - Number(a[1].back));
    for (const [id, entry] of ordered) {
      this.greeted.set(id, now);
      if (entry.name && names.length < settings.maxNames && !names.includes(entry.name)) {
        names.push(entry.name);
        if (entry.back) returning.push(entry.name);
      }
    }
    if (this.greeted.size > 5000) {
      const cutoff = now - settings.regreetMinutes * 60_000;
      for (const [id, at] of this.greeted) if (at < cutoff) this.greeted.delete(id);
    }
    return { names, returning, others: entries.length - names.length };
  }
  get waiting() {
    return this.pending.size;
  }
  clear() {
    this.pending.clear();
  }
}

/** Plain-language payload for the voice model; names stay untrusted audience data. */
export function welcomeText(batch: WelcomeBatch) {
  const parts: string[] = [];
  const fresh = batch.names.filter((n) => !batch.returning.includes(n));
  if (batch.returning.length) parts.push(`กลับมาอีกครั้ง: ${batch.returning.join(", ")}`);
  if (fresh.length) parts.push(`ชื่อ: ${fresh.join(", ")}`);
  if (batch.others) parts.push(`และอีก ${batch.others} คน`);
  return parts.join(" · ");
}
