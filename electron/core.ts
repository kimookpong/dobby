import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SCENE,
  DEFAULT_VOICE_SETTINGS,
  DEFAULT_BRAIN,
  DEFAULT_HOST_SETTINGS,
  DEFAULT_DEBUG,
  DEFAULT_OVERLAY,
  DEFAULT_WELCOME,
  DEFAULT_GIFT_TIERS,
  DEFAULT_REGULARS,
} from "../src/shared";
import type {
  ActionName,
  AppState,
  EmotionName,
  Character,
  Rule,
  ViewerEvent,
  ReplyJob,
  GiftTier,
  GiftTierSettings,
  RegularSettings,
  HostSettings,
  OverlaySettings,
  WelcomeSettings,
} from "../src/shared";

export const actions: ActionName[] = [
  "neutral",
  "wave",
  "heart",
  "happy",
  "surprised",
];
export const defaultRules: Rule[] = [
  { type: "comment", enabled: true, action: "none", enqueue: true },
  { type: "gift", enabled: true, action: "heart", enqueue: true },
  { type: "like", enabled: true, action: "happy", enqueue: false },
  { type: "follow", enabled: true, action: "wave", enqueue: true },
  { type: "join", enabled: true, action: "wave", enqueue: false },
];
export type SavedSettings = {
  hostSettings?: HostSettings;
  overlay?: OverlaySettings;
  welcome?: WelcomeSettings;
  giftTiers?: GiftTierSettings;
  regulars?: RegularSettings;
  character?: Character;
  rules?: Rule[];
  username?: string;
};
/** How long an unanswered comment stays relevant. */
export const COMMENT_TTL = 90_000;
/** Gift and follow thank-yous may be late but should still happen. */
export const THANKS_TTL = 180_000;
/** A reply being spoken that never finishes is released after this. */
export const CLAIMED_TTL = 120_000;
const waitTtl = (job: ReplyJob) =>
  job.type && job.type !== "comment" ? THANKS_TTL : COMMENT_TTL;

export function giftTier(value: number, settings: GiftTierSettings): GiftTier {
  return value >= settings.bigAt ? "big" : value >= settings.mediumAt ? "medium" : "small";
}
export class DobbyCore extends EventEmitter {
  state: AppState;
  private seen = new Map<string, number>();
  private streaks = new Map<string, { count: number; at: number }>();
  private cooldown = new Map<string, number>();
  constructor(
    saved: SavedSettings = {},
    private now = Date.now,
  ) {
    super();
    this.state = {
      hostSettings: saved.hostSettings ?? structuredClone(DEFAULT_HOST_SETTINGS),
      memory: { count: 0, error: "" },
      brain: structuredClone(DEFAULT_BRAIN),
      autoHost: {
        enabled: false,
        status: "stopped",
        message: "ยังไม่เริ่มตอบไลฟ์อัตโนมัติ",
        answered: 0,
        lastQuestion: null,
        lastReply: null,
        turnId: 0,
        turnKind: null,
        recoverable: false,
      },
      scene: { ...DEFAULT_SCENE },
      voice: {
        mode: "speech",
        sessionVoice: null,
        preview: false,
        settings: { ...DEFAULT_VOICE_SETTINGS },
        voices: [],
        status: "disconnected",
        hasCodex: false,
        accountReady: false,
        speaking: false,
        utterance: 0,
        message: "ยังไม่ได้เชื่อมเสียง Codex",
      },
      avatar: {
        models: [],
        selectedId: null,
        modelUrl: null,
        coreUrl: null,
        status: "demo",
        error: "",
        playback: null,
      },
      character: saved.character ?? {
        name: "Dobby",
        personality: "เป็นกันเอง ขี้เล่น ช่างสงสัย",
        speakingStyle: "พูดภาษาไทย ตอบสั้น 1–3 ประโยค เรียกชื่อผู้ชมอย่างเป็นธรรมชาติ",
        language: "th",
      },
      events: [],
      queue: [],
      rules: saved.rules ?? structuredClone(defaultRules),
      action: { name: "neutral", at: 0 },
      emotion: { name: "neutral", at: 0 },
      paused: false,
      stats: { events: 0, comments: 0, gifts: 0, likes: 0, follows: 0 },
      euler: {
        status: "disconnected",
        username: saved.username ?? "",
        hasKey: false,
        message: "ยังไม่ได้เชื่อมต่อ",
      },
      codex: { lastSeen: null },
      audio: { level: 0, active: false },
      output: { url: "", clients: 0 },
      debug: { ...DEFAULT_DEBUG },
      overlay: saved.overlay ?? structuredClone(DEFAULT_OVERLAY),
      welcome: { ...(saved.welcome ?? DEFAULT_WELCOME), waiting: 0 },
      giftTiers: saved.giftTiers ?? { ...DEFAULT_GIFT_TIERS },
      regulars: { ...(saved.regulars ?? DEFAULT_REGULARS), known: 0, regulars: 0 },
    };
  }
  publish() {
    this.emit("change", this.state);
  }
  settings(): SavedSettings {
    return {
      hostSettings: this.state.hostSettings,
      overlay: this.state.overlay,
      welcome: {
        enabled: this.state.welcome.enabled,
        intervalSeconds: this.state.welcome.intervalSeconds,
        maxNames: this.state.welcome.maxNames,
        regreetMinutes: this.state.welcome.regreetMinutes,
      },
      giftTiers: this.state.giftTiers,
      regulars: {
        enabled: this.state.regulars.enabled,
        regularVisits: this.state.regulars.regularVisits,
      },
      character: this.state.character,
      rules: this.state.rules,
      username: this.state.euler.username,
    };
  }
  perform(name: ActionName, viewer?: string) {
    if (!actions.includes(name)) throw new Error("ไม่รู้จักท่าทางนี้");
    this.state.action = { name, at: this.now(), viewer };
    this.emit("action", name);
    this.publish();
  }
  /** Sets the speaking mood; a repeat of the current mood is ignored. */
  setEmotion(name: EmotionName) {
    if (this.state.emotion.name === name) return;
    this.state.emotion = { name, at: this.now() };
    this.publish();
  }
  expire() {
    const now = this.now();
    const dropped: ReplyJob[] = [];
    const queue = this.state.queue.filter((j) => {
      const keep =
        j.status === "claimed"
          ? now - (j.claimedAt ?? j.createdAt) < CLAIMED_TTL
          : now - j.createdAt < waitTtl(j);
      if (!keep) dropped.push(j);
      return keep;
    });
    let changed = dropped.length > 0;
    this.state.queue = queue;
    if (dropped.length) this.emit("queue:dropped", dropped);
    if (
      this.state.action.name !== "neutral" &&
      now - this.state.action.at > 4500
    ) {
      this.state.action = { name: "neutral", at: now };
      changed = true;
    }
    for (const [id, at] of this.seen)
      if (now - at > 300_000) this.seen.delete(id);
    for (const [id, value] of this.streaks)
      if (now - value.at > 300_000) this.streaks.delete(id);
    for (const [id, at] of this.cooldown)
      if (now - at > 30_000) this.cooldown.delete(id);
    if (changed) this.publish();
  }
  ingest(event: ViewerEvent) {
    this.expire();
    const key = `${event.source}:${event.id}`;
    if (this.seen.has(key)) return false;
    this.seen.set(key, this.now());
    if (this.seen.size > 4000) this.seen.delete(this.seen.keys().next().value!);
    let delta = Math.min(1_000_000, Math.max(1, event.count));
    if (event.type === "gift" && event.streakId) {
      const streakKey = `${event.source}:${event.viewerId}:${event.giftId}:${event.streakId}`;
      const previous = this.streaks.get(streakKey)?.count ?? 0;
      delta = Math.max(0, event.count - previous);
      this.streaks.set(streakKey, {
        count: Math.max(previous, event.count),
        at: this.now(),
      });
      if (delta === 0) return false;
      if (this.streaks.size > 2000)
        this.streaks.delete(this.streaks.keys().next().value!);
    }
    const normalized = { ...event, count: delta };
    this.emit("audienceEvent", normalized);
    this.state.events = [normalized, ...this.state.events].slice(0, 100);
    this.state.stats.events++;
    if (event.type === "gift") this.state.stats.gifts += delta;
    if (event.type === "like") this.state.stats.likes += delta;
    if (event.type === "follow") this.state.stats.follows++;
    if (event.type === "comment") this.state.stats.comments++;
    const rule = this.state.rules.find((r) => r.type === event.type);
    if (rule?.enabled && !this.state.paused) {
      const actionKey = `action:${event.type}`;
      const isGift = event.type === "gift";
      // Gifts pick their action from the tier below; other events use the rule's action.
      if (
        !isGift &&
        rule.action !== "none" &&
        this.now() - (this.cooldown.get(actionKey) ?? -Infinity) >= 1500
      ) {
        this.cooldown.set(actionKey, this.now());
        this.perform(rule.action, event.name);
      }
      const queueKey = `reply:${event.type}:${event.viewerId}`;
      const giftKey =
        isGift && event.streakId
          ? `${event.source}:${event.viewerId}:${event.giftId}:${event.streakId}`
          : undefined;
      const existingGift = giftKey
        ? this.state.queue.find(
            (j) => j.giftKey === giftKey && j.status === "waiting",
          )
        : undefined;
      // Unknown gift value counts each gift as 1 diamond.
      const addedValue = (event.diamonds ?? 1) * delta;
      let job: ReplyJob | undefined;
      let previousTier: GiftTier | undefined;
      if (rule.enqueue && existingGift) {
        job = existingGift;
        previousTier = job.giftTier;
        job.giftCount = (job.giftCount ?? 0) + delta;
        job.text = `ขอบคุณสำหรับ ${event.text} ×${job.giftCount}`;
      } else if (rule.enqueue) {
        const tier = isGift ? giftTier(addedValue, this.state.giftTiers) : undefined;
        // A bigger gift is thanked even if the same viewer was answered moments ago.
        const cooled =
          this.now() - (this.cooldown.get(queueKey) ?? -Infinity) >= 15_000;
        if (cooled || (tier && tier !== "small")) {
          this.cooldown.set(queueKey, this.now());
          if (this.state.queue.length >= 20 && tier && tier !== "small") {
            // Make room for a valuable gift by dropping the oldest ordinary waiting job.
            const drop = this.state.queue.findIndex(
              (j) => j.status === "waiting" && !j.priority,
            );
            if (drop >= 0) this.state.queue.splice(drop, 1);
          }
          if (this.state.queue.length < 20) {
            job = {
              id: randomUUID(),
              eventId: event.id,
              name: event.name,
              text:
                event.type === "comment"
                  ? event.text
                  : `${isGift ? `ขอบคุณสำหรับ ${event.text} ×${delta}` : "ขอบคุณที่ติดตาม"}`,
              createdAt: this.now(),
              status: "waiting",
              type: event.type,
              ...(giftKey ? { giftKey, giftCount: delta } : {}),
            };
            this.state.queue.push(job);
          }
        }
      }
      if (isGift) {
        const value = job ? (job.giftValue ?? 0) + addedValue : addedValue;
        const tier = giftTier(value, this.state.giftTiers);
        if (job) {
          job.giftValue = value;
          job.giftTier = tier;
          job.priority = tier === "big" ? 2 : tier === "medium" ? 1 : 0;
        }
        const action =
          tier === "big"
            ? this.state.giftTiers.bigAction
            : tier === "medium"
              ? this.state.giftTiers.mediumAction
              : rule.action;
        // A new medium/big gift or a tier upgrade always reacts; repeats respect the cooldown.
        const upgraded = previousTier !== undefined && previousTier !== tier;
        const freshBig = previousTier === undefined && tier !== "small";
        if (
          action !== "none" &&
          (upgraded ||
            freshBig ||
            this.now() - (this.cooldown.get(actionKey) ?? -Infinity) >= 1500)
        ) {
          this.cooldown.set(actionKey, this.now());
          this.perform(action, event.name);
        }
      }
    }
    this.publish();
    return true;
  }
  claim() {
    this.expire();
    if (
      this.state.paused ||
      this.state.queue.some((j) => j.status === "claimed")
    )
      return null;
    // Highest priority first (gifts by tier), then the newest so replies stay current.
    let job: ReplyJob | undefined;
    for (const j of this.state.queue)
      if (
        j.status === "waiting" &&
        (!job ||
          (j.priority ?? 0) > (job.priority ?? 0) ||
          ((j.priority ?? 0) === (job.priority ?? 0) && j.createdAt >= job.createdAt))
      )
        job = j;
    if (!job) return null;
    job.status = "claimed";
    job.claimedAt = this.now();
    this.publish();
    return { ...job };
  }
  finish(id: string) {
    const job = this.state.queue.find(
      (j) => j.id === id && j.status === "claimed",
    );
    if (!job) throw new Error("งานนี้หมดอายุหรือไม่ได้จองไว้");
    this.state.queue = this.state.queue.filter((j) => j.id !== id);
    this.publish();
  }
  codexSeen() {
    const previous = this.state.codex.lastSeen;
    this.state.codex.lastSeen = this.now();
    // MCP calls are frequent; the "last seen" badge only needs coarse updates.
    if (previous === null || this.state.codex.lastSeen - previous > 5_000)
      this.publish();
  }
  clearSession() {
    this.state.queue = [];
    this.seen.clear();
    this.streaks.clear();
    this.cooldown.clear();
    this.state.action = { name: "neutral", at: this.now() };
    this.publish();
  }
  /** Debug-mode test event: a stable viewerId per name so cooldown and memory behave like a real viewer. */
  testEvent(type: ViewerEvent["type"], name: string, text: string) {
    return this.ingest({
      id: randomUUID(),
      type,
      name,
      viewerId: `test:${name}`,
      source: "demo",
      timestamp: this.now(),
      count: type === "like" ? 10 : 1,
      text:
        text ||
        (type === "comment"
          ? "สวัสดีค่ะ วันนี้คุยเรื่องอะไรกันดี?"
          : type === "gift"
            ? "Rose"
            : type === "follow"
              ? "ติดตามช่องแล้ว"
              : type === "join"
                ? "เข้ามาร่วมไลฟ์"
                : "ส่งหัวใจให้ 10 ครั้ง"),
    });
  }
  simulate(type: ViewerEvent["type"]) {
    const names = ["มะลิ", "คุณชาเขียว", "NightOwl", "พลอย", "Mochi"];
    const name = names[Math.floor(Math.random() * names.length)];
    this.ingest({
      id: randomUUID(),
      type,
      name,
      viewerId: randomUUID(),
      source: "demo",
      timestamp: this.now(),
      count: type === "like" ? 10 : 1,
      text:
        type === "comment"
          ? "วันนี้ Dobby เป็นยังไงบ้าง?"
          : type === "gift"
            ? "Rose"
            : type === "follow"
              ? "ติดตามช่องแล้ว"
              : type === "join"
                ? "เข้ามาร่วมไลฟ์"
                : "ส่งหัวใจให้ 10 ครั้ง",
    });
  }
}
