import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { OverlayView } from "./shared";

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("th", { granularity: "grapheme" })
    : null;
/** Thai vowels and tone marks combine with the previous character; never split them. */
const graphemes = (text: string) =>
  segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : [...text];

/** Speech pace for revealing subtitles; catches up when text arrives in a burst. */
const BASE_RATE = 14; // graphemes per second
const LINGER_MS = 3000;

function useTypewriter(caption: OverlayView["caption"]) {
  const [shown, setShown] = useState(0);
  const [visible, setVisible] = useState(false);
  const turn = useRef<number | null>(null);
  const parts = useMemo(() => graphemes(caption?.text ?? ""), [caption?.text]);
  const target = useRef({ length: 0, speaking: false });
  target.current = { length: parts.length, speaking: !!caption?.speaking };

  useEffect(() => {
    if (!caption) {
      setVisible(false);
      return;
    }
    if (turn.current !== caption.turnId) {
      turn.current = caption.turnId;
      setShown(0);
      // A caption first seen after speech ended is stale (e.g. output reloaded): skip it.
      setVisible(caption.speaking);
    }
  }, [caption?.turnId, caption?.speaking, !!caption]);

  useEffect(() => {
    if (!visible) return;
    let last = performance.now();
    let carry = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      const { length, speaking } = target.current;
      setShown((current) => {
        if (current >= length) return current;
        if (!speaking) return length;
        const backlog = length - current;
        const rate = BASE_RATE * (backlog > 80 ? 3 : backlog > 40 ? 1.6 : 1);
        carry += ((now - last) / 1000) * rate;
        const step = Math.floor(carry);
        carry -= step;
        return Math.min(length, current + step);
      });
      last = now;
    }, 50);
    return () => clearInterval(timer);
  }, [visible]);

  useEffect(() => {
    if (!visible || caption?.speaking) return;
    const timer = setTimeout(() => setVisible(false), LINGER_MS);
    return () => clearTimeout(timer);
  }, [visible, caption?.speaking, caption?.turnId]);

  return { parts, shown: Math.min(shown, parts.length), visible };
}

/** Keeps the newest ~two lines: earlier text scrolls away as speech continues. */
function tail(parts: string[], shown: number, max: number) {
  if (shown <= max) return parts.slice(0, shown).join("");
  let start = shown - max;
  // Prefer to cut at a space so a word is not chopped in half.
  for (let i = start; i < Math.min(shown, start + 20); i++)
    if (parts[i] === " ") {
      start = i + 1;
      break;
    }
  return `…${parts.slice(start, shown).join("")}`;
}

export function Overlay({ view }: { view: OverlayView | null }) {
  const caption = useTypewriter(view?.caption ?? null);
  if (!view) return null;
  const style = { "--overlay-scale": view.textScale } as CSSProperties;
  const maxChars = Math.round(96 / view.textScale);
  const text = tail(caption.parts, caption.shown, maxChars);
  return (
    <div className="stream-overlay" style={style} aria-live="polite">
      {view.card && (
        <div
          className={`overlay-card ${view.card.tone ? `tone-${view.card.tone}` : ""}`}
          key={view.card.turnId}
        >
          <span className="overlay-card-label">{view.card.label}</span>
          <b className="overlay-card-name">
            {view.card.label.startsWith("ยินดีต้อนรับ") ? "" : "@"}
            {view.card.name}
          </b>
          {view.card.text && (
            <span className="overlay-card-text">{view.card.text}</span>
          )}
        </div>
      )}
      {caption.visible && text && (
        <div
          className={`overlay-caption pos-${view.subtitlePosition}`}
          data-done={!view.caption?.speaking}
        >
          <span>{text}</span>
        </div>
      )}
    </div>
  );
}
