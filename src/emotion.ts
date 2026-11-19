import type { EmotionName, EventType } from "./shared";

export const EMOTIONS: EmotionName[] = [
  "neutral",
  "happy",
  "excited",
  "love",
  "surprised",
  "sad",
  "thinking",
  "shy",
  "angry",
];
export const EMOTION_LABELS: Record<EmotionName, string> = {
  neutral: "ปกติ",
  happy: "ยิ้ม / ดีใจ",
  excited: "ตื่นเต้น",
  love: "ซึ้ง / ขอบคุณมาก",
  surprised: "ประหลาดใจ",
  sad: "เศร้า / เห็นใจ",
  thinking: "ครุ่นคิด",
  shy: "เขิน",
  angry: "งอน / ไม่พอใจ",
};

/** Keyword cues (Thai + common English/chat slang) with weights. */
const CUES: [EmotionName, number, RegExp][] = [
  ["excited", 3, /ว้าว|เย้|สุดยอด|เจ๋ง|ตื่นเต้น|มันส์|ปัง|wow|yay|amazing|awesome|!!+/i],
  ["happy", 2, /ดีใจ|ยินดี|สนุก|ยิ้ม|ฮ่า+|555+|haha|lol|ชอบ|น่ารัก|สดใส|เยี่ยม|😊|😄|😆|🥰/i],
  ["love", 3, /ขอบคุณมาก|ซึ้ง|รัก|ใจฟู|อบอุ่น|หัวใจ|love|❤|💕|♡/i],
  ["love", 1, /ขอบคุณ|thank/i],
  ["surprised", 3, /จริงหรอ|จริงเหรอ|หา\?|ตกใจ|ไม่น่าเชื่อ|เอ๊ะ|โอ้โห|อุ๊ย|omg|what\?!|😮|😲/i],
  ["sad", 3, /เสียใจ|เศร้า|ร้องไห้|เหงา|น่าสงสาร|เห็นใจ|ขอโทษ|เสียดาย|sorry|😢|😭/i],
  ["thinking", 2, /อืม+|ขอคิด|น่าคิด|สงสัย|ไม่แน่ใจ|ลองคิด|hmm+|🤔/i],
  ["shy", 3, /เขิน|อาย|ชมเกิน|แหะ|หน้าแดง|blush|☺️|😳/i],
  ["angry", 3, /โกรธ|งอน|หงุดหงิด|ไม่พอใจ|ฮึ่ม|ชิ|😤|😠/i],
];

/**
 * Cheap fallback when the model gives no emotion (Codex Voice transcripts).
 * Returns neutral unless a cue is reasonably clear.
 */
export function detectEmotion(
  text: string,
  eventType?: EventType | "idle" | "welcome",
): { emotion: EmotionName; score: number } {
  const scores = new Map<EmotionName, number>();
  for (const [emotion, weight, cue] of CUES)
    if (cue.test(text)) scores.set(emotion, (scores.get(emotion) ?? 0) + weight);
  // Gifts and follows nudge towards warmth even when the wording is plain.
  if (eventType === "gift") scores.set("love", (scores.get("love") ?? 0) + 2);
  if (eventType === "follow" || eventType === "welcome")
    scores.set("happy", (scores.get("happy") ?? 0) + 2);
  let best: EmotionName = "neutral",
    score = 0;
  for (const [emotion, value] of scores)
    if (value > score) {
      best = emotion;
      score = value;
    }
  return score >= 2 ? { emotion: best, score } : { emotion: "neutral", score: 0 };
}

const GUESS: [EmotionName, RegExp][] = [
  ["happy", /smile|happy|joy|laugh|egao|笑|ยิ้ม/i],
  ["excited", /excit|star|kira|sparkle/i],
  ["love", /love|heart|kiss|ハート/i],
  ["surprised", /surpri|shock|odoro|驚/i],
  ["sad", /sad|cry|tear|kanashi|泣|悲/i],
  ["thinking", /think|hmm|question|confus|\?/i],
  ["shy", /shy|blush|tere|照/i],
  ["angry", /angry|anger|mad|okori|怒/i],
  ["neutral", /normal|neutral|default|idle|base/i],
];

/** Suggests expression mappings from expression file names (many rigs use semantic names). */
export function guessEmotionMappings(expressions: string[]) {
  const result: Partial<Record<EmotionName, string>> = {};
  for (const [emotion, pattern] of GUESS) {
    const match = expressions.find((name) => pattern.test(name));
    if (match) result[emotion] = match;
  }
  return result;
}
