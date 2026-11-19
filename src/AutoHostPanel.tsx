import { useEffect, useState } from "react";
import { Play, Square, Radio } from "lucide-react";
import type { AppState, VoiceSettings, HostSettings } from "./shared";
export function AutoHostPanel({
  state,
  busy,
  onStart,
  onStop,
  settings,
}: {
  state: AppState;
  busy: boolean;
  settings?: VoiceSettings;
  onStart: (settings?: VoiceSettings) => Promise<unknown>;
  onStop: () => Promise<void>;
}) {
  const host = state.autoHost;
  const rehearsal = state.debug.enabled && state.debug.rehearsal;
  const [draft, setDraft] = useState(state.hostSettings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setDraft(state.hostSettings), [
    state.hostSettings.mode, state.hostSettings.storyPrompt, state.hostSettings.productInfo,
  ]);
  const save = async (next: HostSettings) => {
    setSaving(true); setError("");
    try { await window.dobby.command({ type: "hostSettings", settings: next }); }
    catch (e) { setError(e instanceof Error ? e.message : "บันทึกโหมดไม่ได้"); }
    finally { setSaving(false); }
  };
  const welcome = state.welcome;
  const saveWelcome = async (patch: Partial<typeof welcome>) => {
    const { waiting: _waiting, ...current } = welcome;
    setError("");
    try {
      await window.dobby.command({ type: "welcome", settings: { ...current, ...patch } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกการทักคนเข้าห้องไม่ได้");
    }
  };
  const clearMemory = async () => {
    setSaving(true); setError("");
    try { await window.dobby.command({ type: "clearMemory" }); }
    catch (e) { setError(e instanceof Error ? e.message : "ล้างความทรงจำไม่ได้"); }
    finally { setSaving(false); }
  };
  return (
    <section className={`panel auto-host-panel ${host.enabled ? "is-on" : ""}`}>
      <div className="auto-host-heading">
        <span className="section-icon">
          <Radio size={22} />
        </span>
        <div>
          <h2>ตอบไลฟ์อัตโนมัติ</h2>
          <p>AI VTuber คุยกับผู้ชมและชวนคุยเมื่อเงียบครบ 15 วินาที</p>
        </div>
        <span className={`soft-badge ${host.enabled ? "green" : ""}`}>
          {host.enabled ? "AUTO HOST ON" : "หยุดอยู่"}
        </span>
      </div>
      <div className="host-mode-picker" role="group" aria-label="โหมดไลฟ์">
        {([
          ["conversation", "สนทนากับผู้ชม"],
          ["story", "เล่าเรื่องและคุย"],
          ["sales", "ขายของ"],
        ] as const).map(([mode, label]) => (
          <button key={mode} className={`button ${state.hostSettings.mode === mode ? "primary" : "secondary"}`}
            aria-pressed={state.hostSettings.mode === mode} disabled={saving || busy}
            onClick={() => void save({ ...draft, mode })}>{label}</button>
        ))}
      </div>
      {draft.mode === "story" && <label className="field host-mode-details">
        แนวเรื่องหรือจุดเริ่มต้น
        <textarea value={draft.storyPrompt} maxLength={2000} rows={3}
          placeholder="เว้นว่างให้คิดเรื่องเอง หรือเริ่มจากไอเดียผู้ชม"
          onChange={(e) => setDraft({ ...draft, storyPrompt: e.target.value })} />
      </label>}
      {draft.mode === "sales" && <label className="field host-mode-details">
        ข้อมูลสินค้าที่ให้ตัวละครใช้พูด
        <textarea value={draft.productInfo} maxLength={5000} rows={5}
          placeholder="ชื่อสินค้า รายละเอียด ราคา โปรโมชัน และวิธีสั่งซื้อที่ยืนยันแล้ว"
          onChange={(e) => setDraft({ ...draft, productInfo: e.target.value })} />
        <span className="body-copy">ตัวละครใช้ข้อมูลที่กรอก และถามกลับหากยังไม่มีรายละเอียด</span>
      </label>}
      {(draft.storyPrompt !== state.hostSettings.storyPrompt || draft.productInfo !== state.hostSettings.productInfo) &&
        <button className="button secondary" disabled={saving} onClick={() => void save(draft)}>บันทึกข้อมูลโหมด</button>}
      <div className="host-welcome">
        <div className="host-welcome-head">
          <div>
            <b>ทักคนเข้าห้องแบบรวมกลุ่ม</b>
            <small>
              ทักตอนว่างจากคอมเมนต์ เช่น "ยินดีต้อนรับ A, B และอีก 3 คน" · ชื่อที่อ่านไม่ได้
              (อีโมจิล้วน, user1234) นับรวมใน "อีก N คน"
              {host.enabled && welcome.enabled && welcome.waiting > 0
                ? ` · รอทัก ${welcome.waiting} คน`
                : ""}
            </small>
          </div>
          <button
            className={`switch ${welcome.enabled ? "on" : ""}`}
            aria-pressed={welcome.enabled}
            onClick={() => void saveWelcome({ enabled: !welcome.enabled })}
          >
            <span />
          </button>
        </div>
        {welcome.enabled && (
          <div className="host-welcome-options">
            <label className="field">
              ทักห่างกันอย่างน้อย
              <select
                value={welcome.intervalSeconds}
                onChange={(e) => void saveWelcome({ intervalSeconds: Number(e.target.value) })}
              >
                {[15, 25, 45, 60, 120].map((v) => (
                  <option key={v} value={v}>{v} วินาที</option>
                ))}
              </select>
            </label>
            <label className="field">
              เรียกชื่อสูงสุด
              <select
                value={welcome.maxNames}
                onChange={(e) => void saveWelcome({ maxNames: Number(e.target.value) })}
              >
                {[1, 2, 3, 4, 5].map((v) => (
                  <option key={v} value={v}>{v} ชื่อ</option>
                ))}
              </select>
            </label>
            <label className="field">
              ไม่ทักซ้ำภายใน
              <select
                value={welcome.regreetMinutes}
                onChange={(e) => void saveWelcome({ regreetMinutes: Number(e.target.value) })}
              >
                {[5, 15, 30, 60].map((v) => (
                  <option key={v} value={v}>{v} นาที</option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>
      <div className="host-memory-row">
        <span>ความทรงจำ {state.memory.count}/300 ข้อความ · เก็บในเครื่องข้ามการเปิดแอป</span>
        <button className="text-button" disabled={host.enabled || busy || saving || !state.memory.count}
          onClick={() => void clearMemory()}>ล้างความทรงจำ</button>
      </div>
      {(error || state.memory.error) && <p className="has-error" role="alert">{error || state.memory.error}</p>}
      <p
        className={`auto-host-message ${host.status === "error" ? "has-error" : ""}`}
        role="status"
      >
        {busy ? "กำลังเชื่อมเสียงและเตรียมตอบไลฟ์…" : host.message}
      </p>
      <p className="body-copy">
        โมเดลคิดคำตอบ:{" "}
        {state.brain.models.find((m) => m.id === state.brain.selectedId)
          ?.name ??
          state.brain.selectedId ??
          "Codex Voice"}
      </p>
      {state.euler.status !== "connected" && !rehearsal && (
        <p className="body-copy">เชื่อม Euler กับช่องที่กำลัง LIVE ก่อนเริ่ม</p>
      )}
      {state.euler.status !== "connected" && rehearsal && (
        <p className="body-copy">โหมดซ้อม (Debug) · ตอบเหตุการณ์ทดสอบโดยไม่ต้องเชื่อมไลฟ์</p>
      )}
      <div className="voice-buttons">
        <button
          className="button primary"
          disabled={
            busy ||
            host.enabled ||
            state.brain.status === "loading" ||
            (state.euler.status !== "connected" && !rehearsal)
          }
          onClick={() => onStart(settings)}
        >
          <Play size={16} />
          {busy ? "กำลังเริ่ม…" : "เริ่มตอบไลฟ์อัตโนมัติ"}
        </button>
        <button
          className="button secondary"
          disabled={!host.enabled && !busy}
          onClick={onStop}
        >
          <Square size={15} />
          หยุดตอบไลฟ์
        </button>
        <span className="auto-host-count">ตอบแล้ว {host.answered} ข้อความ</span>
      </div>
    </section>
  );
}
