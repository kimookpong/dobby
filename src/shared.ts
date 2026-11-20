export type EventType = "comment" | "gift" | "like" | "follow" | "join";
export type ActionName = "wave" | "heart" | "happy" | "surprised" | "neutral";
/** Facial mood while speaking; separate from audience-triggered actions. */
export type EmotionName =
  | "neutral"
  | "happy"
  | "excited"
  | "love"
  | "surprised"
  | "sad"
  | "thinking"
  | "shy"
  | "angry";
export type ConnectionStatus =
  "disconnected" | "connecting" | "connected" | "reconnecting" | "error";
export interface Character {
  name: string;
  personality: string;
  speakingStyle: string;
  language: string;
}
export interface ViewerEvent {
  id: string;
  type: EventType;
  viewerId: string;
  name: string;
  text: string;
  count: number;
  timestamp: number;
  source: "demo" | "euler";
  giftId?: string;
  streakId?: string;
  streaking?: boolean;
  /** Diamond value of one gift, when Euler provides it. */
  diamonds?: number;
}
export type GiftTier = "small" | "medium" | "big";
export type ViewerStatus = "new" | "returning" | "regular";
export interface ViewerProfile {
  status: ViewerStatus;
  /** Separate lives (visits at least 3 hours apart) this viewer has appeared in. */
  visits: number;
  /** True when this is the viewer's first comment in the current visit. */
  firstCommentThisVisit: boolean;
}
export interface GiftTierSettings {
  /** Total diamonds (value × count) at which a gift becomes medium / big. */
  mediumAt: number;
  bigAt: number;
  /** Small gifts use the gift rule's action; these play for bigger tiers. */
  mediumAction: ActionName;
  bigAction: ActionName;
}
export const DEFAULT_GIFT_TIERS: GiftTierSettings = {
  mediumAt: 10,
  bigAt: 100,
  mediumAction: "happy",
  bigAction: "surprised",
};
export interface RegularSettings {
  /** Remember viewers across lives on this computer. */
  enabled: boolean;
  /** Visits needed before someone counts as a regular. */
  regularVisits: number;
}
export const DEFAULT_REGULARS: RegularSettings = { enabled: true, regularVisits: 3 };
export interface ReplyJob {
  id: string;
  eventId: string;
  name: string;
  text: string;
  createdAt: number;
  status: "waiting" | "claimed";
  claimedAt?: number;
  /** Event that created the job; thank-yous wait longer than comments. */
  type?: EventType;
  giftKey?: string;
  giftCount?: number;
  giftTier?: GiftTier;
  /** Total diamonds of this thank-you (value × count, combined across a streak). */
  giftValue?: number;
  /** Higher is answered first: big gift 2, medium gift 1, everything else 0. */
  priority?: number;
}
export interface Rule {
  type: EventType;
  enabled: boolean;
  action: ActionName | "none";
  enqueue: boolean;
}
export interface ModelSettings {
  scale: number;
  x: number;
  y: number;
  mirror: boolean;
  mouthParameter: string;
}
export interface ModelPlayback {
  kind: "motion" | "expression";
  name: string;
  index?: number;
}
export interface Live2DModelInfo {
  id: string;
  name: string;
  file: string;
  motions: { group: string; index: number; label: string }[];
  expressions: string[];
  settings: ModelSettings;
  mappings: Partial<Record<ActionName, ModelPlayback>>;
  /** Optional for libraries saved before v0.8. */
  emotions?: Partial<Record<EmotionName, ModelPlayback>>;
}
export interface AvatarState {
  models: Live2DModelInfo[];
  selectedId: string | null;
  modelUrl: string | null;
  coreUrl: string | null;
  status: "demo" | "loading" | "ready" | "error";
  error: string;
  playback: (ModelPlayback & { at: number }) | null;
}
export interface SceneSettings {
  width: number;
  height: number;
  background: "transparent" | "solid" | "gradient" | "image" | "video";
  color: string;
  color2: string;
  imageUrl: string | null;
  videoUrl: string | null;
}
export const DEFAULT_SCENE: SceneSettings = {
  width: 1080,
  height: 1920,
  background: "transparent",
  color: "#17332a",
  color2: "#101b2b",
  imageUrl: null,
  videoUrl: null,
};
export interface VoiceSettings {
  voice: string;
  style: string;
  volume: number;
}
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  voice: "cove",
  style: "พูดภาษาไทยอย่างเป็นกันเอง อบอุ่น ชัดเจน และเป็นธรรมชาติ",
  volume: 0.8,
};
export interface VoiceState {
  mode: "speech" | "host";
  sessionVoice: string | null;
  preview: boolean;
  settings: VoiceSettings;
  voices: string[];
  status: "disconnected" | "checking" | "connecting" | "connected" | "error";
  hasCodex: boolean;
  accountReady: boolean;
  speaking: boolean;
  /** Increments per spoken request so the window re-arms even if state updates are merged. */
  utterance: number;
  message: string;
}
export interface AIModelInfo {
  id: string;
  name: string;
  description: string;
  default: boolean;
  effort: string | null;
}
export interface BrainState {
  selectedId: string | null;
  activeModel: string | null;
  models: AIModelInfo[];
  status: "idle" | "loading" | "ready" | "thinking" | "error";
  message: string;
}
export const DEFAULT_BRAIN: BrainState = {
  selectedId: null,
  activeModel: null,
  models: [],
  status: "idle",
  message: "ใช้โมเดลสนทนาเสียง Codex ตามค่าเดิม",
};
export interface HostSettings {
  mode: "conversation" | "story" | "sales";
  storyPrompt: string;
  productInfo: string;
}
export const DEFAULT_HOST_SETTINGS: HostSettings = {
  mode: "conversation",
  storyPrompt: "",
  productInfo: "",
};
export interface ConversationEntry {
  role: "viewer" | "host";
  viewerId?: string;
  name: string;
  text: string;
  at: number;
}
export interface HostContext {
  settings: HostSettings;
  task: "reply" | "idle" | "welcome";
  recentConversation: ConversationEntry[];
  viewerHistory: ConversationEntry[];
}
export interface AppState {
  hostSettings: HostSettings;
  memory: { count: number; error: string };
  brain: BrainState;
  autoHost: {
    enabled: boolean;
    status: "stopped" | "waiting" | "answering" | "paused" | "error";
    message: string;
    answered: number;
    lastQuestion: {
      name: string;
      text: string;
      viewer?: ViewerStatus;
      giftTier?: GiftTier;
    } | null;
    lastReply: string | null;
    /** Increments for every reply or idle turn, so overlays can tell utterances apart. */
    turnId: number;
    turnKind: "reply" | "idle" | "welcome" | null;
    /** True when Auto Host stopped because the voice session dropped, so the app may reconnect. */
    recoverable: boolean;
  };
  voice: VoiceState;
  scene: SceneSettings;
  avatar: AvatarState;
  character: Character;
  events: ViewerEvent[];
  queue: ReplyJob[];
  rules: Rule[];
  action: { name: ActionName; at: number; viewer?: string };
  emotion: { name: EmotionName; at: number };
  paused: boolean;
  stats: {
    events: number;
    comments: number;
    gifts: number;
    likes: number;
    follows: number;
  };
  euler: {
    status: ConnectionStatus;
    username: string;
    hasKey: boolean;
    message: string;
  };
  codex: { lastSeen: number | null };
  audio: { level: number; active: boolean };
  output: { url: string; clients: number };
  debug: DebugSettings;
  overlay: OverlaySettings;
  welcome: WelcomeSettings & { waiting: number };
  giftTiers: GiftTierSettings;
  regulars: RegularSettings & { known: number; regulars: number };
}
export interface WelcomeSettings {
  /** Greet viewers who join, in groups, when the host is not answering anyone. */
  enabled: boolean;
  /** Minimum gap between two welcome turns. */
  intervalSeconds: number;
  /** How many names are said aloud; the rest become "and N others". */
  maxNames: number;
  /** A viewer who rejoins within this window is not greeted again. */
  regreetMinutes: number;
}
export const DEFAULT_WELCOME: WelcomeSettings = {
  enabled: true,
  intervalSeconds: 25,
  maxNames: 3,
  regreetMinutes: 15,
};
export interface OverlaySettings {
  /** Live subtitles of what the character says. */
  subtitles: boolean;
  /** "Replying to @name" card with the viewer's message. */
  replyCard: boolean;
  /** Vertical placement of subtitles; "middle" stays clear of TikTok's chat area. */
  subtitlePosition: "upper" | "middle" | "lower";
  /** 0.8–1.6 multiplier for overlay text size. */
  textScale: number;
  /** Words masked as *** on screen. Case-insensitive, operator-provided. */
  blockedWords: string[];
}
export const DEFAULT_OVERLAY: OverlaySettings = {
  subtitles: false,
  replyCard: false,
  subtitlePosition: "middle",
  textScale: 1,
  blockedWords: [],
};
/** What the broadcast overlay shows right now; derived from state, never persisted. */
export interface OverlayView {
  subtitlePosition: OverlaySettings["subtitlePosition"];
  textScale: number;
  card: {
    turnId: number;
    label: string;
    name: string;
    text: string;
    tone?: "regular" | "gift" | "big";
  } | null;
  caption: { turnId: number; text: string; speaking: boolean } | null;
}
export interface DebugSettings {
  /** Shows metrics and live-test tools. Never persisted: every launch starts off. */
  enabled: boolean;
  /** Lets Auto Host run without a connected Euler room, for offline rehearsal. */
  rehearsal: boolean;
  /** Allows test events while a real LIVE is connected (Auto Host answers aloud). */
  injectOnLive: boolean;
}
export const DEFAULT_DEBUG: DebugSettings = {
  enabled: false,
  rehearsal: false,
  injectOnLive: false,
};
export interface ReplyTiming {
  at: number;
  name: string;
  kind: "reply" | "idle" | "welcome";
  ok: boolean;
  error?: string;
  /** Event arrival → Auto Host claimed it. */
  waitMs: number;
  /** Text-model thinking (0 when Codex Voice answers directly). */
  thinkMs: number;
  /** Speech request → playback finished. */
  speakMs: number;
  totalMs: number;
}
export interface DebugMetrics {
  at: number;
  rates: { publish: number; ipc: number; sse: number; audio: number };
  bytesPerSecond: { ipc: number; sse: number };
  outputClients: number;
  processes: { label: string; pid: number; cpu: number; memoryMB: number }[];
  replies: ReplyTiming[];
  log: { at: number; source: string; message: string }[];
}
export type Command =
  | { type: "hostSettings"; settings: HostSettings }
  | { type: "clearMemory" }
  | { type: "simulate"; eventType: EventType }
  | { type: "debug"; settings: DebugSettings }
  | { type: "overlay"; settings: OverlaySettings }
  | { type: "welcome"; settings: WelcomeSettings }
  | { type: "giftTiers"; settings: GiftTierSettings }
  | { type: "regulars"; settings: RegularSettings }
  | { type: "forgetViewers" }
  | {
      type: "testEvent";
      eventType: EventType;
      names: string[];
      text: string;
      count: number;
      spacingMs: number;
    }
  | { type: "action"; action: ActionName }
  | { type: "pause"; paused: boolean }
  | { type: "clearQueue" }
  | { type: "removeJob"; id: string }
  | { type: "character"; character: Character }
  | { type: "rules"; rules: Rule[] }
  | { type: "saveEuler"; username: string; apiKey: string; remember: boolean }
  | { type: "connectEuler" }
  | { type: "disconnectEuler" }
  | { type: "forgetEuler" }
  | { type: "selectModel"; id: string | null }
  | { type: "modelSettings"; settings: ModelSettings }
  | {
      type: "modelMapping";
      action: ActionName;
      selection: ModelPlayback | null;
    }
  | {
      type: "emotionMapping";
      emotion: EmotionName;
      selection: ModelPlayback | null;
    }
  | { type: "emotion"; emotion: EmotionName }
  | { type: "modelPlay"; selection: ModelPlayback }
  | { type: "scene"; settings: Omit<SceneSettings, "imageUrl" | "videoUrl"> };
export interface DobbyAPI {
  brainPrepare(): Promise<void>;
  brainSelect(id: string | null): Promise<void>;
  voicePrepare(): Promise<void>;
  voiceSettings(settings: VoiceSettings): Promise<void>;
  voiceConnect(
    sdp: string,
    previewSettings?: VoiceSettings,
    mode?: "speech" | "host",
  ): Promise<string>;
  autoHost(enabled: boolean): Promise<void>;
  voiceSpeak(text: string, preview?: boolean): Promise<{ accepted: boolean }>;
  voiceDisconnect(): Promise<void>;
  voicePlayback(event: {
    type: "connected" | "finished" | "error";
    message?: string;
  }): void;
  state(): Promise<AppState>;
  command(command: Command): Promise<AppState>;
  subscribe(callback: (state: AppState) => void): () => void;
  audio(level: number, active: boolean): void;
  copy(text: string): Promise<void>;
  openOutput(): Promise<void>;
  mcpConfig(): Promise<string>;
  importModels(): Promise<{ imported: number; errors: string[] }>;
  importCore(): Promise<boolean>;
  avatarReady(id: string, error?: string): void;
  importBackground(kind: "image" | "video"): Promise<boolean>;
  /** Codex reported that the assistant finished its reply text. */
  onVoiceReplyDone(callback: () => void): () => void;
  debugMetrics(): Promise<DebugMetrics>;
}
declare global {
  interface Window {
    dobby: DobbyAPI;
  }
}
