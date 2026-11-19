/**
 * Turns a TikTok display name into something a voice can say naturally,
 * or null when nothing sayable remains (emoji-only, "user12345", digits).
 */
export function speakableName(raw: string): string | null {
  const cleaned = raw
    .normalize("NFKC") // fancy Unicode letters (𝓜𝓪𝓵𝓲) → plain letters
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️/gu, " ")
    // Keep letters (incl. Thai vowels/tone marks), digits and spaces; drop decorations like ꧁ ꧂ ★.
    .replace(/[^\p{L}\p{M}\p{N} ]/gu, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  if (/^user\s?\d+$/i.test(cleaned)) return null;
  const letters = cleaned.replace(/[\p{N} ]/gu, "");
  if ([...letters].length < 2) return null;
  // Long trailing numbers ("NightOwl 1999", "mali888") are rarely part of how people say a name.
  const trimmed = cleaned.replace(/\s?\p{N}{3,}$/u, "").trim() || cleaned;
  const chars = [...trimmed];
  return chars.length > 20 ? chars.slice(0, 20).join("").trim() : trimmed;
}
