import { useAudioLevel } from "./audio-level";
import { useEffect, useState } from "react";
import {
  AudioLines,
  Check,
  Play,
  RefreshCw,
  Square,
  Volume2,
} from "lucide-react";
import type { AppState, VoiceSettings } from "./shared";
import type { useCodexVoice } from "./useCodexVoice";
import { SceneFrame } from "./SceneFrame";
import { AutoHostPanel } from "./AutoHostPanel";
export function VoicePage({
  state,
  player,
  notify,
  hostStarting,
  startHost,
  stopHost,
}: {
  state: AppState;
  player: ReturnType<typeof useCodexVoice>;
  notify: (s: string) => void;
  hostStarting: boolean;
  startHost: (settings?: VoiceSettings) => Promise<unknown>;
  stopHost: () => Promise<void>;
}) {
  const voice = state.voice;
  const [draft, setDraft] = useState<VoiceSettings>(voice.settings),
    [text, setText] = useState("สวัสดี ฉันคือดอบบี้ ยินดีต้อนรับทุกคนเข้าสู่ไลฟ์ของเรานะ"),
    [checking, setChecking] = useState(false),
    [previewPending, setPreviewPending] = useState<string | null>(null);
  useEffect(
    () => setDraft(voice.settings),
    [voice.settings.voice, voice.settings.style, voice.settings.volume],
  );
  const dirty =
    draft.voice !== voice.settings.voice ||
    draft.style !== voice.settings.style ||
    draft.volume !== voice.settings.volume;
  const checkingOrConnecting =
    voice.status === "checking" || voice.status === "connecting" || checking;
  const prepare = async () => {
    setChecking(true);
    try {
      await window.dobby.voicePrepare();
    } catch (e) {
      notify(
        e instanceof Error
          ? e.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              "",
            )
          : "ตรวจ Codex ไม่สำเร็จ",
      );
    } finally {
      setChecking(false);
    }
  };
  const speak = async (value: string) => {
    try {
      await player.resume();
      await window.dobby.voiceSpeak(value);
    } catch (e) {
      notify(
        e instanceof Error
          ? e.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              "",
            )
          : "พูดข้อความไม่ได้",
      );
    }
  };
  const previewVoice = async (name: string) => {
    if (previewPending) return;
    if (voice.preview && voice.sessionVoice === name && voice.speaking) {
      await player.disconnect();
      return;
    }
    setPreviewPending(name);
    try {
      await player.disconnect();
      const connected = await player.connect({ ...draft, voice: name }, true);
      if (connected) {
        await player.resume();
        await window.dobby.voiceSpeak(
          `สวัสดี ฉันคือ${state.character.name} ยินดีที่ได้รู้จักทุกคนนะ`,
          true,
        );
      }
    } catch (e) {
      notify(
        e instanceof Error
          ? e.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              "",
            )
          : "ฟังตัวอย่างไม่ได้",
      );
    } finally {
      setPreviewPending(null);
    }
  };
  return (
    <div className="voice-layout">
      <section className="panel settings-panel">
        <div className="section-intro">
          <span className="section-icon">
            <AudioLines />
          </span>
          <div>
            <h2>เสียงพูดของ Dobby</h2>
            <p>ใช้ Codex ที่ล็อกอินด้วย ChatGPT · ไม่ต้องใช้ API key</p>
          </div>
        </div>
        <div
          className={`voice-status ${voice.status === "error" ? "is-error" : ""}`}
          role="status"
        >
          <span className={voice.status === "connected" ? "status-dot" : ""} />
          {voice.message}
        </div>
        <button
          className="button secondary"
          disabled={checkingOrConnecting || voice.status === "connected"}
          onClick={prepare}
        >
          <RefreshCw size={15} />
          {checking ? "กำลังตรวจ Codex…" : "ตรวจ Codex และโหลดรายชื่อเสียง"}
        </button>
        <div className="voice-choice-section">
          <div className="voice-choice-heading">
            <span id="voice-choice-label">เสียงตัวละคร</span>
            <span className="soft-badge">{voice.voices.length} เสียง</span>
          </div>
          {!voice.voices.length ? (
            <div className="voice-choice-empty">
              <AudioLines size={24} />
              <span>กดตรวจ Codex เพื่อโหลดเสียงที่ใช้ได้</span>
            </div>
          ) : (
            <div
              className="voice-cards"
              role="radiogroup"
              aria-labelledby="voice-choice-label"
            >
              {voice.voices.map((v, index) => (
                <div
                  key={v}
                  className={`voice-card ${draft.voice === v ? "selected" : ""}`}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={draft.voice === v}
                    aria-label={`เสียง ${v.charAt(0).toUpperCase() + v.slice(1)}`}
                    tabIndex={draft.voice === v ? 0 : -1}
                    disabled={checkingOrConnecting}
                    className="voice-card-select"
                    onClick={() => setDraft({ ...draft, voice: v })}
                    onKeyDown={(event) => {
                      const delta = ["ArrowRight", "ArrowDown"].includes(
                        event.key,
                      )
                        ? 1
                        : ["ArrowLeft", "ArrowUp"].includes(event.key)
                          ? -1
                          : 0;
                      if (!delta) return;
                      event.preventDefault();
                      const next =
                        (index + delta + voice.voices.length) %
                        voice.voices.length;
                      setDraft({ ...draft, voice: voice.voices[next] });
                      event.currentTarget
                        .closest(".voice-cards")
                        ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                        [next]?.focus();
                    }}
                  >
                    <span className="voice-card-symbol">
                      <AudioLines size={18} />
                    </span>
                    <strong>{v.charAt(0).toUpperCase() + v.slice(1)}</strong>
                    <span className="voice-card-caption">
                      {draft.voice === v ? "เลือกอยู่" : "Codex Voice"}
                    </span>
                    {draft.voice === v && (
                      <Check className="voice-card-check" size={14} />
                    )}
                  </button>
                  <button
                    className={`voice-card-preview ${voice.preview && voice.sessionVoice === v ? "is-playing" : ""}`}
                    type="button"
                    aria-label={`ฟังตัวอย่างเสียง ${v.charAt(0).toUpperCase() + v.slice(1)}`}
                    disabled={
                      checkingOrConnecting ||
                      !!previewPending ||
                      state.autoHost.enabled
                    }
                    onClick={() => previewVoice(v)}
                  >
                    {voice.preview &&
                    voice.sessionVoice === v &&
                    voice.speaking ? (
                      <Square size={12} />
                    ) : (
                      <Volume2 size={13} />
                    )}
                    {previewPending === v
                      ? "กำลังเตรียม…"
                      : voice.preview &&
                          voice.sessionVoice === v &&
                          voice.speaking
                        ? "หยุดตัวอย่าง"
                        : "ฟังตัวอย่าง"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <label className="field">
          สไตล์การพูด
          <textarea
            rows={3}
            maxLength={1200}
            value={draft.style}
            onChange={(e) => setDraft({ ...draft, style: e.target.value })}
            placeholder="เช่น พูดภาษาไทย เสียงอบอุ่น สดใส เว้นจังหวะชัดเจน"
          />
        </label>
        <label className="field">
          ระดับเสียง {Math.round(draft.volume * 100)}%
          <input
            aria-label="ระดับเสียงพูด"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={draft.volume}
            onChange={(e) =>
              setDraft({ ...draft, volume: Number(e.target.value) })
            }
          />
        </label>
        <label className="field">
          อุปกรณ์เล่นเสียง
          <select
            aria-label="อุปกรณ์เล่นเสียง"
            value={player.sink}
            onChange={(e) => player.selectOutput(e.target.value)}
          >
            <option value="">อุปกรณ์เสียงเริ่มต้น</option>
            {player.outputs
              .filter((d) => d.deviceId !== "default")
              .map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `อุปกรณ์เสียง ${i + 1}`}
                </option>
              ))}
          </select>
        </label>
        <div className="voice-buttons">
          <button
            className="button primary"
            disabled={
              !voice.accountReady ||
              state.autoHost.enabled ||
              checkingOrConnecting ||
              (voice.status === "connected" && !dirty && !voice.preview)
            }
            onClick={async () => {
              await player.disconnect();
              await player.connect(draft);
            }}
          >
            <Check size={16} />
            {voice.status === "connected" && !dirty && !voice.preview
              ? "เชื่อมเสียงแล้ว"
              : "บันทึกและเชื่อมเสียง"}
          </button>
          <button
            className="button secondary"
            disabled={voice.status === "disconnected" && !voice.speaking}
            onClick={player.disconnect}
          >
            <Square size={15} />
            หยุดเสียง / ตัดการเชื่อมต่อ
          </button>
        </div>
        {dirty && <p className="body-copy">กดบันทึกและเชื่อมเสียงเพื่อใช้ค่าที่เลือก</p>}
        <div className="info-note">
          ใช้โควตา Voice ของบัญชี Codex ตามสิทธิ์ที่มี การเชื่อมต่อเสียงส่วนนี้ยังเป็นฟีเจอร์ทดลอง
          และจะหยุดเมื่อไม่ได้ใช้งาน 2 นาที
        </div>
      </section>
      <div className="voice-right">
        <AutoHostPanel
          state={state}
          busy={hostStarting}
          onStart={startHost}
          onStop={stopHost}
          settings={draft}
        />
        <section className="panel voice-preview">
          <div className="panel-heading">
            <h2>
              <Volume2 size={17} />
              ฟังเสียงและดูตัวละคร
            </h2>
            <span className="soft-badge">
              {voice.preview
                ? `ฟังตัวอย่าง · ${voice.sessionVoice}`
                : voice.speaking
                  ? "กำลังพูด"
                  : "PREVIEW"}
            </span>
          </div>
          <div className="voice-avatar-preview">
            <SceneFrame state={state} />
          </div>
          <VoiceMeter signal={player.signal} />
        </section>
        <section className="panel settings-panel">
          <label className="field">
            ข้อความที่จะให้ Dobby พูด
            <textarea
              rows={4}
              maxLength={1000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="voice-buttons">
            <button
              className="button primary"
              disabled={
                voice.status !== "connected" ||
                state.autoHost.enabled ||
                voice.preview ||
                voice.speaking ||
                !text.trim() ||
                dirty
              }
              onClick={() => speak(text)}
            >
              <Play size={16} />
              พูดข้อความนี้
            </button>
            <button
              className="button secondary"
              disabled={
                checkingOrConnecting ||
                !!previewPending ||
                !voice.voices.length ||
                state.autoHost.enabled
              }
              onClick={() => previewVoice(draft.voice)}
            >
              <Volume2 size={16} />
              ฟังตัวอย่างเสียง
            </button>
          </div>
          <p className="body-copy voice-disclosure">
            เสียงที่ได้สร้างโดย AI · ส่งเสียงแอป Dobby เข้า LIVE Studio แยกจากภาพ output
            เพื่อไม่ให้เสียงเล่นซ้ำ
          </p>
        </section>
      </div>
    </div>
  );
}

function VoiceMeter({ signal }: { signal: unknown }) {
  const { level } = useAudioLevel();
  return (
    <div
      className="voice-meter"
      aria-label="ระดับเสียงที่ใช้ขยับปาก"
      data-signal={JSON.stringify(signal)}
    >
      <i style={{ width: `${Math.min(100, level * 100)}%` }} />
    </div>
  );
}
