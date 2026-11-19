import { z } from "zod";
const action = z.enum(["neutral", "wave", "heart", "happy", "surprised"]);
const eventType = z.enum(["comment", "gift", "like", "follow", "join"]);
export const emotionSchema = z.enum([
  "neutral",
  "happy",
  "excited",
  "love",
  "surprised",
  "sad",
  "thinking",
  "shy",
  "angry",
]);
export const hostSettingsSchema = z.object({
  mode: z.enum(["conversation", "story", "sales"]),
  storyPrompt: z.string().trim().max(2000),
  productInfo: z.string().trim().max(5000),
});
export const overlaySchema = z.object({
  subtitles: z.boolean(),
  replyCard: z.boolean(),
  subtitlePosition: z.enum(["upper", "middle", "lower"]),
  textScale: z.number().min(0.8).max(1.6),
  blockedWords: z.array(z.string().trim().min(1).max(60)).max(200),
});
export const giftTierSchema = z.object({
  mediumAt: z.number().int().min(1).max(1_000_000),
  bigAt: z.number().int().min(2).max(1_000_000),
  mediumAction: action,
  bigAction: action,
});
export const regularSchema = z.object({
  enabled: z.boolean(),
  regularVisits: z.number().int().min(2).max(50),
});
export const welcomeSchema = z.object({
  enabled: z.boolean(),
  intervalSeconds: z.number().int().min(10).max(300),
  maxNames: z.number().int().min(1).max(5),
  regreetMinutes: z.number().int().min(1).max(240),
});
export const sceneSchema = z.object({
  width: z.number().int().min(240).max(3840),
  height: z.number().int().min(240).max(3840),
  background: z.enum(["transparent", "solid", "gradient", "image", "video"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  color2: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export const modelSettingsSchema = z.object({
  scale: z.number().min(0.2).max(4),
  x: z.number().min(-100).max(100),
  y: z.number().min(-100).max(100),
  mirror: z.boolean(),
  mouthParameter: z.string().min(1).max(100),
});
export const playbackSchema = z.object({
  kind: z.enum(["motion", "expression"]),
  name: z.string().max(150),
  index: z.number().int().min(0).max(1000).optional(),
});
export const characterSchema = z.object({
  name: z.string().trim().min(1).max(40),
  personality: z.string().max(1500),
  speakingStyle: z.string().max(1500),
  language: z.string().max(20),
});
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hostSettings"), settings: hostSettingsSchema }),
  z.object({ type: z.literal("clearMemory") }),
  z.object({ type: z.literal("scene"), settings: sceneSchema }),
  z.object({
    type: z.literal("selectModel"),
    id: z.string().max(100).nullable(),
  }),
  z.object({ type: z.literal("modelSettings"), settings: modelSettingsSchema }),
  z.object({
    type: z.literal("modelMapping"),
    action,
    selection: playbackSchema.nullable(),
  }),
  z.object({ type: z.literal("modelPlay"), selection: playbackSchema }),
  z.object({
    type: z.literal("emotionMapping"),
    emotion: emotionSchema,
    selection: playbackSchema.nullable(),
  }),
  z.object({ type: z.literal("emotion"), emotion: emotionSchema }),
  z.object({ type: z.literal("simulate"), eventType }),
  z.object({
    type: z.literal("debug"),
    settings: z.object({
      enabled: z.boolean(),
      rehearsal: z.boolean(),
      injectOnLive: z.boolean(),
    }),
  }),
  z.object({ type: z.literal("overlay"), settings: overlaySchema }),
  z.object({ type: z.literal("welcome"), settings: welcomeSchema }),
  z.object({ type: z.literal("giftTiers"), settings: giftTierSchema }),
  z.object({ type: z.literal("regulars"), settings: regularSchema }),
  z.object({ type: z.literal("forgetViewers") }),
  z.object({
    type: z.literal("testEvent"),
    eventType,
    names: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
    text: z.string().trim().max(1000),
    count: z.number().int().min(1).max(50),
    spacingMs: z.number().int().min(0).max(10_000),
  }),
  z.object({ type: z.literal("action"), action }),
  z.object({ type: z.literal("pause"), paused: z.boolean() }),
  z.object({ type: z.literal("clearQueue") }),
  z.object({ type: z.literal("removeJob"), id: z.string().max(100) }),
  z.object({ type: z.literal("character"), character: characterSchema }),
  z.object({
    type: z.literal("rules"),
    rules: z
      .array(
        z.object({
          type: eventType,
          enabled: z.boolean(),
          action: z.union([action, z.literal("none")]),
          enqueue: z.boolean(),
        }),
      )
      .length(5)
      .refine((r) => new Set(r.map((x) => x.type)).size === 5),
  }),
  z.object({
    type: z.literal("saveEuler"),
    username: z
      .string()
      .trim()
      .regex(/^@?[a-zA-Z0-9_.]{1,64}$/),
    apiKey: z.string().trim().max(4096),
    remember: z.boolean(),
  }),
  z.object({ type: z.literal("connectEuler") }),
  z.object({ type: z.literal("disconnectEuler") }),
  z.object({ type: z.literal("forgetEuler") }),
]);
