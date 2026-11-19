import { EventEmitter } from "node:events";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ConversationEntry, HostContext, HostSettings } from "../src/shared";
import { conversationEntrySchema } from "./host-context";

/** Bounded local conversation history; never included in broadcast output. */
export class ConversationMemory extends EventEmitter {
  private entries: ConversationEntry[] = [];
  private writing: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  error = "";
  constructor(private folder?: string) { super(); }
  get count() { return this.entries.length; }
  async load() {
    if (!this.folder) return;
    try {
      this.entries = z.array(conversationEntrySchema).max(300).parse(
        JSON.parse(await readFile(join(this.folder, "conversation-memory.json"), "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.error = "อ่านความทรงจำเดิมไม่ได้ · เริ่มเก็บบทสนทนาใหม่";
    }
  }
  remember(entry: ConversationEntry) {
    this.entries.push(conversationEntrySchema.parse({
      ...entry,
      ...(entry.viewerId ? { viewerId: entry.viewerId.slice(0, 200) } : {}),
      name: entry.name.slice(0, 100),
      text: entry.text.slice(0, 1200),
    }));
    this.entries = this.entries.slice(-300);
    this.emit("change");
    if (this.folder && !this.timer) {
      this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 250);
      this.timer.unref();
    }
  }
  context(settings: HostSettings, task: HostContext["task"], viewerId?: string): HostContext {
    const recentConversation = this.entries.slice(-30);
    const viewerHistory = viewerId
      ? this.entries.slice(0, -30).filter((e) => e.viewerId === viewerId).slice(-12)
      : [];
    return structuredClone({ settings, task, recentConversation, viewerHistory });
  }
  async clear() {
    this.entries = [];
    this.emit("change");
    await this.flush();
  }
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.folder) return Promise.resolve();
    const folder = this.folder;
    const data = JSON.stringify(this.entries);
    this.writing = this.writing.then(async () => {
      try {
        await mkdir(folder, { recursive: true });
        const file = join(folder, "conversation-memory.json");
        await writeFile(file + ".tmp", data, { mode: 0o600 });
        await rename(file + ".tmp", file);
        this.error = "";
      } catch {
        this.error = "บันทึกความทรงจำไม่ได้ · รอบนี้จำในแอปเท่านั้น";
      }
      this.emit("change");
    });
    return this.writing;
  }
}
