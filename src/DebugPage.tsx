import { useEffect, useState } from "react";
import { Activity, Bug, FlaskConical, ListOrdered, Send, Timer } from "lucide-react";
import type { AppState, Command, DebugMetrics, EventType } from "./shared";
import { live2dStats } from "./Live2DAvatar";

/** Polls main-process metrics once per second while mounted. */
export function useDebugMetrics(active: boolean) {
  const [metrics, setMetrics] = useState<DebugMetrics | null>(null);
  const [fps, setFps] = useState<ReturnType<typeof live2dStats>>(null);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const poll = async () => {
      try {
        const next = await window.dobby.debugMetrics();
        if (!stopped) {
          setMetrics(next);
          setFps(live2dStats());
        }
      } catch {
        /* Window closing or main process busy; try again next tick. */
      }
    };
    void poll();
    const timer = setInterval(poll, 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active]);
  return { metrics, fps };
}

const kb = (bytes: number) =>
  bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB/s` : `${bytes} B/s`;
const ms = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)} วิ` : `${value} ms`;
const time = (at: number) =>
  new Date(at).toLocaleTimeString("th-TH", { hour12: false });
const totalCpu = (m: DebugMetrics | null) =>
  m ? Math.round(m.processes.reduce((sum, p) => sum + p.cpu, 0)) : 0;

const NAME_PRESETS: { label: string; names: string; text: string; count: number; spacing: number }[] = [
  { label: "คอมเมนต์เดียว", names: "มะลิ", text: "", count: 1, spacing: 0 },
  {
    label: "ชื่อยาก (อีโมจิ/อังกฤษ/ตัวเลข)",
    names: "🌸มะลิ🌸, NightOwl_1999, ꧁พลอย꧂, user8823412, Mochi🍡",
    text: "สวัสดีค่ะ เรียกชื่อหนูถูกไหม?",
    count: 5,
    spacing: 1500,
  },
  {
    label: "คอมเมนต์ถี่ 20 ข้อความ",
    names: "A, B, C, D, E, F, G, H, I, J",
    text: "ทดสอบคอมเมนต์ถี่",
    count: 20,
    spacing: 300,
  },
  { label: "คนเดิมพิมพ์ซ้ำ", names: "พลอย", text: "ตอบหนูหน่อย", count: 4, spacing: 2000 },
];

export function DebugPage({
  state,
  command,
}: {
  state: AppState;
  command: (c: Command) => Promise<boolean>;
}) {
  const debug = state.debug;
  const { metrics, fps } = useDebugMetrics(true);
  const [eventType, setEventType] = useState<EventType>("comment");
  const [names, setNames] = useState("มะลิ");
  const [text, setText] = useState("");
  const [count, setCount] = useState(1);
  const [spacing, setSpacing] = useState(1000);
  const live = state.euler.status === "connected";
  const canInject = debug.enabled && (!live || debug.injectOnLive);
  const toggle = (key: keyof typeof debug) =>
    void command({ type: "debug", settings: { ...debug, [key]: !debug[key] } });
  const send = () => {
    const list = names
      .split(/[,\n]/)
      .map((n) => n.trim())
      .filter(Boolean)
      .slice(0, 20);
    if (!list.length) return;
    void command({
      type: "testEvent",
      eventType,
      names: list,
      text,
      count: Math.max(1, Math.min(50, count)),
      spacingMs: Math.max(0, Math.min(10_000, spacing)),
    });
  };
  const Switch = ({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) => (
    <button className={`switch ${on ? "on" : ""}`} onClick={onClick} disabled={disabled} aria-pressed={on}>
      <span />
    </button>
  );
  return (
    <div className="debug-page">
      <div className="connections-grid">
        <section className="panel settings-panel">
          <div className="section-intro">
            <span className="section-icon"><Bug /></span>
            <div>
              <h2>โหมด Debug</h2>
              <p>ดูค่าประสิทธิภาพและทดสอบการไลฟ์ · ปิดเองทุกครั้งที่เปิดแอปใหม่</p>
            </div>
            <span className={`status-dot ${debug.enabled ? "" : "muted"}`} />
          </div>
          <div className="debug-toggle">
            <div><b>เปิดโหมด Debug</b><small>แสดงแผงค่าวัดลอยมุมจอ และเปิดเครื่องมือทดสอบ</small></div>
            <Switch on={debug.enabled} onClick={() => toggle("enabled")} />
          </div>
          <div className="debug-toggle">
            <div><b>ซ้อมไลฟ์โดยไม่ต้องเชื่อม Euler</b><small>เริ่ม Auto Host ได้เลย ตอบเหตุการณ์ทดสอบด้วยเสียงและโมเดลจริง</small></div>
            <Switch on={debug.rehearsal} disabled={!debug.enabled} onClick={() => toggle("rehearsal")} />
          </div>
          <div className="debug-toggle warn">
            <div><b>ทดสอบระหว่างไลฟ์จริง</b><small>ส่งเหตุการณ์ทดสอบขณะเชื่อม Euler · Auto Host จะพูดตอบออกไลฟ์ ใช้กับบัญชีทดสอบเท่านั้น</small></div>
            <Switch on={debug.injectOnLive} disabled={!debug.enabled} onClick={() => toggle("injectOnLive")} />
          </div>
        </section>
        <section className="panel settings-panel">
          <div className="section-intro">
            <span className="section-icon"><FlaskConical /></span>
            <div>
              <h2>ส่งเหตุการณ์ทดสอบ</h2>
              <p>อยู่ใน Dobby เท่านั้น ไม่ส่งเข้า TikTok · ชื่อเดิมนับเป็นผู้ชมคนเดิม</p>
            </div>
          </div>
          <div className="debug-presets">
            {NAME_PRESETS.map((p) => (
              <button
                key={p.label}
                className="button secondary"
                onClick={() => {
                  setEventType("comment");
                  setNames(p.names);
                  setText(p.text);
                  setCount(p.count);
                  setSpacing(p.spacing);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="debug-form">
            <label className="field">
              ประเภท
              <select value={eventType} onChange={(e) => setEventType(e.target.value as EventType)}>
                <option value="comment">คอมเมนต์</option>
                <option value="gift">ของขวัญ</option>
                <option value="follow">ติดตาม</option>
                <option value="like">ไลก์</option>
                <option value="join">เข้าห้อง</option>
              </select>
            </label>
            <label className="field">
              จำนวน
              <input type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            </label>
            <label className="field">
              เว้นระยะ (ms)
              <input type="number" min={0} max={10000} step={100} value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} />
            </label>
          </div>
          <label className="field">
            ชื่อผู้ชม (คั่นด้วย , หรือขึ้นบรรทัดใหม่ · วนตามลำดับ)
            <textarea rows={2} value={names} onChange={(e) => setNames(e.target.value)} />
          </label>
          <label className="field">
            ข้อความ (เว้นว่างเพื่อใช้ข้อความตัวอย่าง)
            <input value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="button-row">
            <button className="button primary" disabled={!canInject} onClick={send}>
              <Send size={15} /> ส่งเหตุการณ์ทดสอบ
            </button>
            {!debug.enabled && <span className="body-copy">เปิดโหมด Debug ก่อน</span>}
            {debug.enabled && live && !debug.injectOnLive && (
              <span className="body-copy">กำลังเชื่อมไลฟ์จริง · เปิด "ทดสอบระหว่างไลฟ์จริง" ก่อน</span>
            )}
          </div>
        </section>
      </div>

      <div className="stats-row debug-stats">
        <Stat label="Preview FPS" value={fps ? `${fps.fps}` : "–"} hint={fps ? `จำกัด ${fps.maxFps} fps${fps.attached ? "" : " · ไม่ได้แสดง"}` : "ยังไม่โหลดโมเดล Live2D"} />
        <Stat label="State publish" value={`${metrics?.rates.publish ?? 0}/s`} hint={`IPC ${metrics?.rates.ipc ?? 0}/s · ${kb(metrics?.bytesPerSecond.ipc ?? 0)}`} />
        <Stat label="Output (SSE)" value={`${metrics?.rates.sse ?? 0}/s`} hint={`${kb(metrics?.bytesPerSecond.sse ?? 0)} · ${metrics?.outputClients ?? 0} หน้าต่าง`} />
        <Stat label="CPU รวม" value={`${totalCpu(metrics)}%`} hint={`เสียงปาก ${metrics?.rates.audio ?? 0} เฟรม/s`} />
      </div>

      <div className="connections-grid">
        <section className="panel">
          <div className="panel-heading"><h2><Timer size={15} />เวลาตอบผู้ชม (ล่าสุด)</h2></div>
          <table className="debug-table">
            <thead><tr><th>เวลา</th><th>ผู้ชม</th><th>รอคิว</th><th>คิด</th><th>พูด</th><th>รวม</th></tr></thead>
            <tbody>
              {metrics?.replies.length ? metrics.replies.map((r) => (
                <tr key={`${r.at}-${r.name}`} className={r.ok ? "" : "bad"}>
                  <td>{time(r.at)}</td>
                  <td>{r.kind === "idle" ? "ชวนคุย" : r.name}</td>
                  <td>{ms(r.waitMs)}</td>
                  <td>{r.thinkMs ? ms(r.thinkMs) : "–"}</td>
                  <td>{ms(r.speakMs)}</td>
                  <td>{ms(r.totalMs)}</td>
                </tr>
              )) : <tr><td colSpan={6} className="empty">ยังไม่มีคำตอบ · เริ่ม Auto Host แล้วส่งเหตุการณ์ทดสอบ</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="panel">
          <div className="panel-heading"><h2><Activity size={15} />โปรเซส</h2></div>
          <table className="debug-table">
            <thead><tr><th>โปรเซส</th><th>PID</th><th>CPU</th><th>RAM</th></tr></thead>
            <tbody>
              {(metrics?.processes ?? []).slice().sort((a, b) => b.cpu - a.cpu).map((p) => (
                <tr key={p.pid}><td>{p.label}</td><td>{p.pid}</td><td>{p.cpu}%</td><td>{p.memoryMB} MB</td></tr>
              ))}
            </tbody>
          </table>
          <p className="body-copy debug-note">ไม่รวม Codex CLI และ TikTok LIVE Studio ซึ่งเป็นโปรเซสแยก</p>
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading"><h2><ListOrdered size={15} />บันทึกเหตุการณ์ระบบ</h2></div>
        <ol className="debug-log">
          {metrics?.log.length ? metrics.log.map((l, i) => (
            <li key={`${l.at}-${i}`}><time>{time(l.at)}</time><b>{l.source}</b><span>{l.message}</span></li>
          )) : <li className="empty">ยังไม่มีเหตุการณ์</li>}
        </ol>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

/** Floating mini readout shown on other pages while debug mode is on. */
export function DebugHud({ onOpen }: { onOpen: () => void }) {
  const { metrics, fps } = useDebugMetrics(true);
  const last = metrics?.replies[0];
  return (
    <button className="debug-hud" onClick={onOpen} title="เปิดหน้า Debug">
      <b>DEBUG</b>
      <span>FPS {fps ? fps.fps : "–"}</span>
      <span>publish {metrics?.rates.publish ?? 0}/s</span>
      <span>CPU {totalCpu(metrics)}%</span>
      {last && <span>ตอบล่าสุด {ms(last.totalMs)}</span>}
    </button>
  );
}
