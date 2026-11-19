import { EventEmitter } from "node:events";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { RegularSettings, ViewerEvent, ViewerProfile, ViewerStatus } from "../src/shared";

const VISIT_GAP = 3 * 60 * 60_000; // appearances 3h apart count as separate lives
const MAX_VIEWERS = 3000;
const record = z.object({
  name: z.string().max(100),
  firstSeen: z.number(),
  lastSeen: z.number(),
  visits: z.number().int().min(1),
  visitComments: z.number().int().min(0),
});
type ViewerRecord = z.infer<typeof record>;

/**
 * Local-only memory of who has watched before, keyed by Euler viewer id.
 * Updates are O(1) per event and saved in the background at most every few seconds.
 */
export class ViewerRegistry extends EventEmitter {
  private viewers = new Map<string, ViewerRecord>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  constructor(
    private folder?: string,
    private now = Date.now,
  ) {
    super();
  }
  get size() {
    return this.viewers.size;
  }
  regularCount(settings: RegularSettings) {
    let n = 0;
    for (const v of this.viewers.values()) if (v.visits >= settings.regularVisits) n++;
    return n;
  }
  async load() {
    if (!this.folder) return;
    try {
      const raw = JSON.parse(await readFile(join(this.folder, "viewers.json"), "utf8"));
      for (const [id, value] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_VIEWERS)) {
        const parsed = record.safeParse(value);
        if (parsed.success && id.length <= 200) this.viewers.set(id, parsed.data);
      }
    } catch {
      /* First launch or unreadable file: start fresh. */
    }
  }
  /** Records an audience event and returns the viewer's status for this appearance. */
  record(event: ViewerEvent, settings: RegularSettings): ViewerProfile | null {
    if (!settings.enabled || event.source !== "euler" && !event.viewerId.startsWith("test:"))
      return null;
    const now = this.now();
    let viewer = this.viewers.get(event.viewerId);
    if (!viewer) {
      viewer = { name: event.name.slice(0, 100), firstSeen: now, lastSeen: now, visits: 1, visitComments: 0 };
      this.viewers.set(event.viewerId, viewer);
      this.prune();
    } else {
      if (now - viewer.lastSeen > VISIT_GAP) {
        viewer.visits++;
        viewer.visitComments = 0;
      }
      viewer.lastSeen = now;
      viewer.name = event.name.slice(0, 100);
      // Map order doubles as recency order for pruning.
      this.viewers.delete(event.viewerId);
      this.viewers.set(event.viewerId, viewer);
    }
    const firstCommentThisVisit = event.type === "comment" && viewer.visitComments === 0;
    if (event.type === "comment") viewer.visitComments++;
    this.scheduleSave();
    return { status: this.status(viewer, settings), visits: viewer.visits, firstCommentThisVisit };
  }
  profile(viewerId: string | undefined, settings: RegularSettings): ViewerProfile | null {
    if (!settings.enabled || !viewerId) return null;
    const viewer = this.viewers.get(viewerId);
    if (!viewer) return null;
    return { status: this.status(viewer, settings), visits: viewer.visits, firstCommentThisVisit: false };
  }
  private status(viewer: ViewerRecord, settings: RegularSettings): ViewerStatus {
    return viewer.visits >= settings.regularVisits ? "regular" : viewer.visits >= 2 ? "returning" : "new";
  }
  private prune() {
    while (this.viewers.size > MAX_VIEWERS) this.viewers.delete(this.viewers.keys().next().value!);
  }
  private scheduleSave() {
    if (!this.folder || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 5000);
    this.timer.unref?.();
    this.emit("change");
  }
  async clear() {
    this.viewers.clear();
    this.emit("change");
    await this.flush();
  }
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.folder) return Promise.resolve();
    const folder = this.folder;
    const data = JSON.stringify(Object.fromEntries(this.viewers));
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        await mkdir(folder, { recursive: true });
        const file = join(folder, "viewers.json");
        await writeFile(file + ".tmp", data, { mode: 0o600 });
        await rename(file + ".tmp", file);
      })
      .catch(() => {});
    return this.writing;
  }
}
