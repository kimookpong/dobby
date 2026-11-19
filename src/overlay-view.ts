import type { AppState, OverlaySettings, OverlayView } from "./shared";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Audience text is untrusted: strip control characters, collapse spaces, mask blocked words, cap length. */
export function cleanOverlayText(
  text: string,
  blockedWords: readonly string[],
  max: number,
) {
  let clean = text
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = blockedWords.map((w) => w.trim()).filter(Boolean);
  if (words.length)
    clean = clean.replace(
      new RegExp(words.map(escapeRegExp).join("|"), "gi"),
      (match) => "*".repeat(Math.min(6, Math.max(3, [...match].length))),
    );
  const chars = [...clean];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : clean;
}

function replyBadge(q: NonNullable<AppState["autoHost"]["lastQuestion"]>): {
  label: string;
  tone?: "regular" | "gift" | "big";
} {
  if (q.giftTier === "big") return { label: "ขอบคุณของขวัญสุดพิเศษ", tone: "big" };
  if (q.giftTier) return { label: "ขอบคุณของขวัญ", tone: "gift" };
  if (q.viewer === "regular") return { label: "กำลังตอบ · ขาประจำ", tone: "regular" };
  if (q.viewer === "returning") return { label: "กำลังตอบ · กลับมาอีกครั้ง", tone: "regular" };
  return { label: "กำลังตอบ" };
}

type OverlaySource = Pick<AppState, "autoHost" | "voice"> & {
  overlay: OverlaySettings;
};

/** Pure: computes what the broadcast overlay should show from app state. */
export function overlayView(state: OverlaySource): OverlayView {
  const settings = state.overlay;
  const host = state.autoHost;
  const answering = host.enabled && host.status === "answering";
  const card =
    settings.replyCard &&
    answering &&
    (host.turnKind === "reply" || host.turnKind === "welcome") &&
    host.lastQuestion
      ? host.turnKind === "welcome"
        ? {
            turnId: host.turnId,
            label: "ยินดีต้อนรับ",
            // Welcome names are already cleaned for speech; "and N others" stays as the message.
            name: cleanOverlayText(host.lastQuestion.name, settings.blockedWords, 60),
            text: cleanOverlayText(
              host.lastQuestion.text.replace(/^ชื่อ: [^·]*·?\s*/, ""),
              settings.blockedWords,
              60,
            ),
          }
        : {
            turnId: host.turnId,
            ...replyBadge(host.lastQuestion),
            name: cleanOverlayText(host.lastQuestion.name, settings.blockedWords, 40),
            text: cleanOverlayText(host.lastQuestion.text, settings.blockedWords, 140),
          }
      : null;
  const caption =
    settings.subtitles && host.enabled && host.lastReply
      ? {
          turnId: host.turnId,
          text: cleanOverlayText(host.lastReply, settings.blockedWords, 1200),
          speaking: answering,
        }
      : null;
  return {
    subtitlePosition: settings.subtitlePosition,
    textScale: settings.textScale,
    card: card && card.name ? card : null,
    caption: caption && caption.text ? caption : null,
  };
}
