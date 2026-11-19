import type { DobbyCore } from "./core";
import type { DobbyVoice } from "./voice";
import type { EmotionName, ReplyJob, ReplyTiming, ViewerEvent } from "../src/shared";
import { detectEmotion } from "../src/emotion";
import { WelcomeBatcher, welcomeText } from "./welcome";
import type { ViewerRegistry } from "./viewers";
import type { ViewerProfile } from "../src/shared";
import { ConversationMemory } from "./memory";
import type { DobbyBrain } from "./brain";
/** Owns one live audience reply at a time; never enabled on app startup. */
export class AutoHost {
  private current: ReplyJob | null = null;
  private scheduled = false;
  private pumping = false;
  private awaitingPlayback = false;
  private generation = 0;
  private proactive = false;
  private quietSince = 0;
  private viewerId: string | undefined;
  /** Mood detection on streamed transcripts runs only when text grows, at most twice per turn. */
  private mood = { changes: 0, checkedLength: 0, eventType: "comment" as ViewerEvent["type"] | "idle" | "welcome" };
  private welcomes: WelcomeBatcher;
  /** What this realtime voice session has already been told (reset per session). */
  private sent = { at: 0, viewers: new Set<string>() };
  /** Status at the moment each viewer's latest event arrived (small, bounded). */
  private profiles = new Map<string, ViewerProfile>();
  /** Debug timings for the reply in progress. */
  private timing: { name: string; kind: ReplyTiming["kind"]; created: number;
    claimed: number; thinkMs: number; speakAt: number } | null = null;
  constructor(
    private core: DobbyCore,
    private voice: DobbyVoice,
    private brain?: DobbyBrain,
    readonly memory = new ConversationMemory(),
    private now = Date.now,
    private viewers?: ViewerRegistry,
  ) {
    this.welcomes = new WelcomeBatcher(now);
    core.on("change", this.changed);
    core.on("audienceEvent", this.audienceEvent);
    memory.on("change", this.memoryChanged);
    this.memoryChanged();
    voice.on("change", this.voiceChanged);
    voice.on("utteranceFinished", this.finished);
    voice.on("transcript", this.transcript);
  }
  private memoryChanged = () => {
    this.core.state.memory = { count: this.memory.count, error: this.memory.error };
    this.core.publish();
  };
  private audienceEvent = (event: ViewerEvent) => {
    const profile = this.viewers?.record(event, this.core.state.regulars);
    if (profile && event.type !== "like") {
      if (this.profiles.size > 500) this.profiles.clear();
      this.profiles.set(event.viewerId, profile);
    }
    if (event.type === "join") {
      const rule = this.core.state.rules.find((r) => r.type === "join");
      if (this.core.state.autoHost.enabled && rule?.enabled && !this.core.state.paused) {
        this.welcomes.add(event.viewerId, event.name, this.core.state.welcome, profile?.status);
        this.syncWelcomeCount();
      }
      return;
    }
    if (!["comment", "gift", "follow"].includes(event.type)) return;
    this.memory.remember({ role: "viewer", viewerId: event.viewerId,
      name: event.name, text: event.type === "comment" ? event.text : `[${event.type}] ${event.text}`,
      at: event.timestamp });
  };
  private syncWelcomeCount() {
    // Shown in the panel; only publish when the number actually changes.
    if (this.core.state.welcome.waiting === this.welcomes.waiting) return;
    this.core.state.welcome.waiting = this.welcomes.waiting;
    this.core.publish();
  }
  /** Called by the main-process clock even when no events arrive. */
  tick() { this.schedule(); }
  private state(
    status: typeof this.core.state.autoHost.status,
    message: string,
  ) {
    const host = this.core.state.autoHost;
    if (host.status === status && host.message === message) return;
    host.status = status;
    host.message = message;
    this.core.publish();
  }
  /** Live room connected, or debug rehearsal lets the host run offline. */
  private roomReady() {
    return this.core.state.euler.status === "connected" ||
      (this.core.state.debug.enabled && this.core.state.debug.rehearsal);
  }
  private emitTiming(ok: boolean, error?: string) {
    const t = this.timing;
    this.timing = null;
    if (!t) return;
    const now = this.now();
    this.core.emit("debug:reply", {
      at: now, name: t.name, kind: t.kind, ok, ...(error ? { error } : {}),
      waitMs: Math.max(0, t.claimed - t.created), thinkMs: t.thinkMs,
      speakMs: t.speakAt ? now - t.speakAt : 0,
      totalMs: Math.max(0, now - t.created),
    } satisfies ReplyTiming);
  }
  start() {
    if (!this.roomReady())
      throw new Error("เชื่อม Euler กับไลฟ์ก่อนเริ่ม Auto Host (หรือเปิดโหมดซ้อมในหน้า Debug)");
    if (
      this.voice.state.status !== "connected" ||
      this.voice.state.mode !== "host" ||
      this.voice.state.preview
    )
      throw new Error("เชื่อมเสียงโหมด Auto Host ก่อน");
    if (this.core.state.autoHost.enabled) return;
    this.generation++;
    this.quietSince = this.now();
    // A fresh voice session knows nothing yet: the first turn carries the full recent context.
    this.sent = { at: 0, viewers: new Set() };
    this.core.state.autoHost.enabled = true;
    this.core.state.autoHost.recoverable = false;
    this.voice.keepAlive(true);
    this.state("waiting", "Auto Host เปิดแล้ว · รอข้อความใหม่จากผู้ชม");
    this.schedule();
  }
  stop(message = "หยุดตอบไลฟ์อัตโนมัติแล้ว", error = false, recoverable = false) {
    this.generation++;
    this.welcomes.clear();
    this.syncWelcomeCount();
    if (this.timing) this.emitTiming(false, message);
    this.core.state.autoHost.enabled = false;
    this.core.state.autoHost.recoverable = recoverable;
    this.brain?.cancel();
    const job = this.current;
    this.current = null;
    this.awaitingPlayback = false;
    this.proactive = false;
    if (job)
      this.core.state.queue = this.core.state.queue.filter(
        (j) => j.id !== job.id,
      );
    this.voice.keepAlive(false);
    this.core.setEmotion("neutral");
    this.state(error ? "error" : "stopped", message);
  }
  private changed = () => {
    if (!this.core.state.autoHost.enabled) return;
    if (!this.roomReady()) {
      this.stop("ไลฟ์ตัดการเชื่อมต่อ · Auto Host หยุดแล้ว", true);
      this.voice.disconnect();
      return;
    }
    if (this.core.state.paused) {
      this.state("paused", "พัก Auto Host · รอให้เปิด Action อีกครั้ง");
      return;
    }
    this.schedule();
  };
  private voiceChanged = () => {
    if (!this.core.state.autoHost.enabled) return;
    if (
      this.voice.state.status !== "connected" ||
      this.voice.state.preview ||
      this.voice.state.mode !== "host"
    )
      this.stop("เสียงตัดการเชื่อมต่อ · กำลังลองเชื่อมใหม่อัตโนมัติ", true, true);
    else this.schedule();
  };
  private schedule() {
    if (
      this.scheduled ||
      this.pumping ||
      this.current ||
      !this.core.state.autoHost.enabled
    )
      return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      void this.pump();
    });
  }
  private async pump() {
    if (this.pumping || this.current || !this.core.state.autoHost.enabled)
      return;
    if (this.core.state.paused || this.voice.state.speaking) return;
    this.pumping = true;
    const generation = this.generation;
    let claimed = false;
    try {
      // Priority: queued viewers → grouped welcome → idle chatter after 15s of quiet.
      let job = this.core.claim();
      const proactive = !job;
      let kind: "reply" | "idle" | "welcome" = job ? "reply" : "idle";
      if (!job) {
        const batch = this.welcomes.take(this.core.state.welcome);
        this.syncWelcomeCount();
        if (batch) {
          kind = "welcome";
          job = { id: `welcome:${this.now()}`, eventId: "",
            name: batch.names.length ? batch.names.join(", ") : "ผู้ชมที่เพิ่งเข้ามา",
            text: welcomeText(batch), createdAt: this.now(), status: "claimed" };
        } else {
          this.state("waiting", "รอผู้ชม · ทักหรือเล่าต่อเมื่อเงียบครบ 15 วินาที");
          if (this.now() - this.quietSince < 15_000) return;
          job = { id: `idle:${this.now()}`, eventId: "", name: "ผู้ชมทุกคน",
            text: "", createdAt: this.now(), status: "claimed" };
        }
      }
      claimed = true;
      this.timing = { name: job.name, kind,
        created: job.createdAt, claimed: this.now(), thinkMs: 0, speakAt: 0 };
      this.proactive = proactive;
      this.current = job;
      const sourceEvent = kind === "reply"
        ? this.core.state.events.find((e) => e.id === job.eventId) : undefined;
      this.viewerId = sourceEvent?.viewerId;
      const viewerProfile = this.viewerId ? this.profiles.get(this.viewerId) ?? null : null;
      this.core.state.autoHost.turnId++;
      this.core.state.autoHost.turnKind = kind;
      this.core.state.autoHost.lastQuestion =
        kind === "idle" ? { name: "ชวนคุยอัตโนมัติ", text: "เงียบครบ 15 วินาที" }
        : kind === "welcome" ? { name: job.name, text: job.text }
        : { name: job.name, text: job.text,
            ...(viewerProfile && viewerProfile.status !== "new" ? { viewer: viewerProfile.status } : {}),
            ...(job.giftTier ? { giftTier: job.giftTier } : {}) };
      this.core.state.autoHost.lastReply = null;
      const audience = {
        name: job.name.slice(0, 100), text: job.text.slice(0, 1000),
        type: kind === "reply" ? sourceEvent?.type ?? "comment" : kind,
        ...(viewerProfile ? { viewer: viewerProfile } : {}),
        ...(job.giftTier ? { giftTier: job.giftTier } : {}),
      };
      this.mood = { changes: 0, checkedLength: 0,
        eventType: kind === "reply" ? sourceEvent?.type ?? "comment" : kind };
      if (kind === "welcome") this.core.setEmotion("happy");
      // A text model starts a fresh thread per reply and needs the full context;
      // the realtime voice session keeps history, so it only gets what is new.
      const usesBrain = !!this.brain?.state.selectedId;
      const context = usesBrain
        ? this.memory.context(this.core.state.hostSettings, kind, this.viewerId)
        : this.memory.contextSince(this.core.state.hostSettings, kind, this.viewerId,
            this.sent.at, !!this.viewerId && !this.sent.viewers.has(this.viewerId));
      if (!usesBrain) {
        this.sent.at = Math.max(this.sent.at, this.memory.latestAt);
        if (this.viewerId) this.sent.viewers.add(this.viewerId);
      }
      if (usesBrain && this.brain) {
        this.state(
          "answering",
          `กำลังคิดคำตอบให้ ${job.name} · ${this.brain.state.selectedId}`,
        );
        // Thinking can take seconds; showing it keeps the character from looking frozen.
        this.core.setEmotion("thinking");
        const thinkStart = this.now();
        const reply = await this.brain.respond(
          this.core.state.character,
          audience,
          context,
        );
        if (this.timing) this.timing.thinkMs = this.now() - thinkStart;
        if (generation !== this.generation || !this.core.state.autoHost.enabled)
          return;
        this.core.expire();
        if ((!proactive && !this.core.state.queue.some((j) => j.id === job.id)) ||
          (proactive && this.core.state.queue.some((j) => j.status === "waiting")) ||
          this.core.state.paused) {
          if (!proactive) {
            const pending = this.core.state.queue.find((j) => j.id === job.id);
            if (pending) { pending.status = "waiting"; delete pending.claimedAt; }
          }
          this.timing = null;
          this.current = null;
          this.core.setEmotion("neutral");
          return;
        }
        this.core.state.autoHost.lastReply = reply;
        const chosen = (this.brain as { lastEmotion?: EmotionName }).lastEmotion;
        this.core.setEmotion(chosen ?? detectEmotion(reply, this.mood.eventType).emotion);
        this.mood.changes = 2; // The model's choice holds for the whole reply.
        this.state("answering", `กำลังตอบ ${job.name}`);
        this.awaitingPlayback = true;
        if (this.timing) this.timing.speakAt = this.now();
        await this.voice.speak({ text: reply });
      } else {
        this.state("answering", `กำลังตอบ ${job.name}`);
        this.awaitingPlayback = true;
        if (this.timing) this.timing.speakAt = this.now();
        await this.voice.respondAudience(audience, context);
      }
    } catch (e) {
      if (generation === this.generation) {
        this.stop(e instanceof Error ? e.message : "ตอบไลฟ์ไม่สำเร็จ", true, true);
        this.voice.disconnect();
      }
    } finally {
      this.pumping = false;
      if (claimed && !this.current) this.schedule();
    }
  }
  private transcript = (text: string) => {
    if (this.brain?.state.selectedId) return;
    if (!this.current || !this.core.state.autoHost.enabled) return;
    const old = this.core.state.autoHost.lastReply;
    const reply = old ? `${old} ${text}`.slice(0, 1200) : text.slice(0, 1200);
    this.core.state.autoHost.lastReply = reply;
    this.updateMood(reply);
    this.core.publish();
  };
  private updateMood(reply: string) {
    if (this.mood.changes >= 2 || reply.length - this.mood.checkedLength < 8) return;
    this.mood.checkedLength = reply.length;
    const { emotion, score } = detectEmotion(reply, this.mood.eventType);
    const current = this.core.state.emotion.name;
    // First mood needs a clear cue; a later switch needs a stronger one to avoid flicker.
    if (emotion === "neutral" || emotion === current) return;
    if (this.mood.changes === 1 && score < 3) return;
    this.mood.changes++;
    this.core.setEmotion(emotion);
  }
  private finished = () => {
    if (
      !this.awaitingPlayback ||
      !this.current ||
      !this.core.state.autoHost.enabled
    )
      return;
    const id = this.current.id;
    const proactive = this.proactive;
    if (this.core.state.autoHost.lastReply)
      this.memory.remember({ role: "host", viewerId: this.viewerId,
        name: this.core.state.character.name, text: this.core.state.autoHost.lastReply,
        at: this.now() });
    this.quietSince = this.now();
    this.emitTiming(true);
    this.core.setEmotion("neutral");
    this.current = null;
    this.proactive = false;
    this.awaitingPlayback = false;
    try {
      if (!proactive) this.core.finish(id);
    } catch {
      /* Already expired or skipped while audio was playing. */
    }
    if (!proactive) this.core.state.autoHost.answered++;
    this.state("waiting", "ตอบแล้ว · รอข้อความถัดไปจากผู้ชม");
    this.schedule();
  };
  dispose() {
    this.stop();
    this.core.off("change", this.changed);
    this.core.off("audienceEvent", this.audienceEvent);
    this.memory.off("change", this.memoryChanged);
    void this.memory.flush();
    this.voice.off("change", this.voiceChanged);
    this.voice.off("utteranceFinished", this.finished);
    this.voice.off("transcript", this.transcript);
  }
}
