import type { DobbyCore } from "./core";
import type { DebugMetrics, ReplyJob, ReplyTiming } from "../src/shared";

type ProcessSample = { label: string; pid: number; cpu: number; memoryMB: number };

/**
 * Collects live-test diagnostics in the main process. Counting is always cheap;
 * byte sizes are only measured while debug mode is on.
 */
export class DebugMonitor {
  private counts = { publish: 0, ipc: 0, sse: 0, audio: 0 };
  private bytes = { ipc: 0, sse: 0 };
  private since = Date.now();
  private replies: ReplyTiming[] = [];
  private log: DebugMetrics["log"] = [];
  private last = { autoHost: "", euler: "", voice: "", brain: "" };
  constructor(
    private core: DobbyCore,
    private processes: () => ProcessSample[] = () => [],
  ) {
    core.on("change", this.changed);
    core.on("audio", this.audio);
    core.on("debug:sse", this.sse);
    core.on("debug:reply", this.reply);
    core.on("queue:dropped", this.dropped);
  }
  get enabled() {
    return this.core.state.debug.enabled;
  }
  ipcSent(measure: () => number) {
    this.counts.ipc++;
    if (this.enabled) this.bytes.ipc += measure();
  }
  note(source: string, message: string) {
    this.log.unshift({ at: Date.now(), source, message: message.slice(0, 300) });
    this.log.length = Math.min(this.log.length, 80);
  }
  private changed = () => {
    this.counts.publish++;
    const s = this.core.state;
    // Record status transitions so a test run leaves a readable timeline.
    const watch = [
      ["autoHost", `${s.autoHost.status} · ${s.autoHost.message}`],
      ["euler", `${s.euler.status} · ${s.euler.message}`],
      ["voice", `${s.voice.status}${s.voice.speaking ? " (พูด)" : ""} · ${s.voice.message}`],
      ["brain", `${s.brain.status} · ${s.brain.message}`],
    ] as const;
    for (const [key, value] of watch)
      if (this.last[key] !== value) {
        if (this.last[key]) this.note(key, value);
        this.last[key] = value;
      }
  };
  private audio = () => {
    this.counts.audio++;
  };
  private sse = (size: number) => {
    this.counts.sse++;
    this.bytes.sse += size;
  };
  private dropped = (jobs: ReplyJob[]) => {
    this.note(
      "queue",
      `ข้าม ${jobs.length} รายการที่รอนานเกินไป: ${jobs.map((j) => j.name).join(", ")}`,
    );
  };
  private reply = (timing: ReplyTiming) => {
    this.replies.unshift(timing);
    this.replies.length = Math.min(this.replies.length, 30);
    this.note(
      "reply",
      `${timing.ok ? "ตอบ" : "ล้มเหลว"} ${timing.name} · รอคิว ${timing.waitMs}ms · คิด ${timing.thinkMs}ms · พูด ${timing.speakMs}ms${timing.error ? ` · ${timing.error}` : ""}`,
    );
  };
  snapshot(): DebugMetrics {
    const now = Date.now();
    const seconds = Math.max(0.001, (now - this.since) / 1000);
    const rate = (n: number) => Math.round((n / seconds) * 10) / 10;
    const metrics: DebugMetrics = {
      at: now,
      rates: {
        publish: rate(this.counts.publish),
        ipc: rate(this.counts.ipc),
        sse: rate(this.counts.sse),
        audio: rate(this.counts.audio),
      },
      bytesPerSecond: {
        ipc: Math.round(this.bytes.ipc / seconds),
        sse: Math.round(this.bytes.sse / seconds),
      },
      outputClients: this.core.state.output.clients,
      processes: this.processes(),
      replies: [...this.replies],
      log: [...this.log],
    };
    this.counts = { publish: 0, ipc: 0, sse: 0, audio: 0 };
    this.bytes = { ipc: 0, sse: 0 };
    this.since = now;
    return metrics;
  }
  dispose() {
    this.core.off("change", this.changed);
    this.core.off("audio", this.audio);
    this.core.off("debug:sse", this.sse);
    this.core.off("debug:reply", this.reply);
    this.core.off("queue:dropped", this.dropped);
  }
}
