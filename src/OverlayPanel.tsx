import { useEffect, useState } from "react";
import { Captions, Eye, EyeOff } from "lucide-react";
import type { AppState, Command, OverlaySettings, OverlayView } from "./shared";
import { cleanOverlayText } from "./overlay-view";

const SAMPLE_NAME = "มะลิ🌸";
const SAMPLE_COMMENT = "วันนี้ Dobby เป็นยังไงบ้าง?";
const SAMPLE_REPLY =
  "สวัสดีค่ะคุณมะลิ วันนี้ Dobby สดใสมากเลย ขอบคุณที่แวะมาคุยกันนะคะ มีอะไรอยากเล่าให้ฟังไหม";

/** Local-only sample so placement can be judged without starting Auto Host. Never sent to output. */
export function useOverlaySample(state: AppState) {
  const [on, setOn] = useState(false);
  const [turn, setTurn] = useState(-1);
  const settings = state.overlay;
  const view: OverlayView | undefined = on
    ? {
        subtitlePosition: settings.subtitlePosition,
        textScale: settings.textScale,
        card: settings.replyCard
          ? {
              turnId: turn,
              label: "กำลังตอบ",
              name: cleanOverlayText(SAMPLE_NAME, settings.blockedWords, 40),
              text: cleanOverlayText(SAMPLE_COMMENT, settings.blockedWords, 140),
            }
          : null,
        caption: settings.subtitles
          ? {
              turnId: turn,
              text: cleanOverlayText(SAMPLE_REPLY, settings.blockedWords, 1200),
              speaking: true,
            }
          : null,
      }
    : undefined;
  return {
    on,
    view,
    toggle: () => {
      setOn((v) => !v);
      setTurn((t) => t - 1); // replay the typing animation
    },
  };
}

export function OverlayPanel({
  state,
  command,
  sample,
}: {
  state: AppState;
  command: (c: Command) => Promise<boolean>;
  sample: ReturnType<typeof useOverlaySample>;
}) {
  const settings = state.overlay;
  const [words, setWords] = useState(settings.blockedWords.join(", "));
  useEffect(() => {
    setWords(settings.blockedWords.join(", "));
  }, [settings.blockedWords.join("\n")]);
  const save = (patch: Partial<OverlaySettings>) =>
    command({ type: "overlay", settings: { ...settings, ...patch } });
  const saveWords = () => {
    const blockedWords = [
      ...new Set(
        words
          .split(/[,\n]/)
          .map((w) => w.trim().slice(0, 60))
          .filter(Boolean),
      ),
    ].slice(0, 200);
    if (blockedWords.join("\n") !== settings.blockedWords.join("\n"))
      void save({ blockedWords });
  };
  const Switch = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button className={`switch ${on ? "on" : ""}`} onClick={onClick} aria-pressed={on}>
      <span />
    </button>
  );
  return (
    <section className="panel settings-panel overlay-settings">
      <div className="section-intro">
        <span className="section-icon">
          <Captions />
        </span>
        <div>
          <h2>Overlay บนจอไลฟ์</h2>
          <p>ซับไตเติลและการ์ดชื่อผู้ชม แสดงทั้ง preview และ output</p>
        </div>
      </div>
      <div className="debug-toggle">
        <div>
          <b>ซับไตเติลคำพูด</b>
          <small>ขึ้นตามจังหวะที่ตัวละครพูด คนที่ปิดเสียงก็ตามได้</small>
        </div>
        <Switch on={settings.subtitles} onClick={() => void save({ subtitles: !settings.subtitles })} />
      </div>
      <div className="debug-toggle">
        <div>
          <b>การ์ด "กำลังตอบ @ชื่อ"</b>
          <small>โชว์ชื่อและข้อความผู้ชมที่กำลังตอบ ขึ้นตั้งแต่เริ่มคิดคำตอบ</small>
        </div>
        <Switch on={settings.replyCard} onClick={() => void save({ replyCard: !settings.replyCard })} />
      </div>
      <label className="field">
        ตำแหน่งซับไตเติล
        <div className="segmented">
          {(
            [
              ["upper", "สูง"],
              ["middle", "กลาง (แนะนำ)"],
              ["lower", "ต่ำ"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`button secondary ${settings.subtitlePosition === value ? "selected" : ""}`}
              onClick={() => void save({ subtitlePosition: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </label>
      <label className="field">
        ขนาดตัวอักษร · {Math.round(settings.textScale * 100)}%
        <input
          type="range"
          min={0.8}
          max={1.6}
          step={0.1}
          value={settings.textScale}
          onChange={(e) => void save({ textScale: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        คำที่ไม่ให้ขึ้นจอ (คั่นด้วย , · แสดงเป็น *** · ภาษาไทยจับคำที่อยู่ในคำอื่นด้วย
        เช่น "บ้า" จะปิด "บ้าง" ให้ใส่คำที่เจาะจง)
        <textarea
          rows={2}
          value={words}
          placeholder="เช่น คำหยาบ, ชื่อที่ไม่ต้องการ"
          onChange={(e) => setWords(e.target.value)}
          onBlur={saveWords}
        />
      </label>
      <div className="button-row">
        <button className="button secondary" onClick={sample.toggle}>
          {sample.on ? <EyeOff size={15} /> : <Eye size={15} />}
          {sample.on ? "ปิดตัวอย่าง" : "ดูตัวอย่างใน preview"}
        </button>
      </div>
      <p className="body-copy">
        ตำแหน่ง "กลาง" เว้นพื้นที่แชตด้านล่างและปุ่มด้านขวาของ TikTok ·
        ตัวอย่างแสดงเฉพาะในหน้านี้ ไม่ออกไลฟ์
      </p>
    </section>
  );
}
