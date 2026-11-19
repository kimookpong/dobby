import { useEffect, useState } from "react";
import { Gift, UsersRound } from "lucide-react";
import type { ActionName, AppState, Command, GiftTierSettings } from "./shared";

const ACTIONS: [ActionName, string][] = [
  ["neutral", "ปกติ"],
  ["wave", "โบกมือ"],
  ["heart", "หัวใจ"],
  ["happy", "ดีใจ"],
  ["surprised", "ตกใจ"],
];

export function GiftTierPanel({
  state,
  command,
}: {
  state: AppState;
  command: (c: Command) => Promise<boolean>;
}) {
  const tiers = state.giftTiers;
  const [medium, setMedium] = useState(String(tiers.mediumAt));
  const [big, setBig] = useState(String(tiers.bigAt));
  useEffect(() => {
    setMedium(String(tiers.mediumAt));
    setBig(String(tiers.bigAt));
  }, [tiers.mediumAt, tiers.bigAt]);
  const save = (patch: Partial<GiftTierSettings>) =>
    command({ type: "giftTiers", settings: { ...tiers, ...patch } });
  const commitNumbers = () => {
    const mediumAt = Math.max(1, Math.round(Number(medium) || tiers.mediumAt));
    const bigAt = Math.max(mediumAt + 1, Math.round(Number(big) || tiers.bigAt));
    if (mediumAt !== tiers.mediumAt || bigAt !== tiers.bigAt) void save({ mediumAt, bigAt });
    else {
      setMedium(String(tiers.mediumAt));
      setBig(String(tiers.bigAt));
    }
  };
  const smallAction =
    state.rules.find((r) => r.type === "gift")?.action ?? "none";
  return (
    <section className="panel settings-panel">
      <div className="section-intro">
        <span className="section-icon">
          <Gift />
        </span>
        <div>
          <h2>ของขวัญแบ่งระดับ</h2>
          <p>ของขวัญใหญ่ได้ท่าพิเศษ การ์ดสีทอง และได้ตอบก่อนคิวอื่น</p>
        </div>
      </div>
      <div className="tier-grid">
        <div className="tier-row">
          <b>เล็ก</b>
          <span>ต่ำกว่า {tiers.mediumAt} เพชร</span>
          <span className="tier-action">
            ท่า: {ACTIONS.find(([id]) => id === smallAction)?.[1] ?? "ไม่เล่นท่า"} (ตามกติกาของขวัญด้านบน)
          </span>
        </div>
        <div className="tier-row">
          <b>กลาง</b>
          <label className="field">
            ตั้งแต่ (เพชร)
            <input type="number" min={1} value={medium} onChange={(e) => setMedium(e.target.value)} onBlur={commitNumbers} />
          </label>
          <label className="field">
            ท่าทาง
            <select value={tiers.mediumAction} onChange={(e) => void save({ mediumAction: e.target.value as ActionName })}>
              {ACTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        </div>
        <div className="tier-row is-big">
          <b>ใหญ่</b>
          <label className="field">
            ตั้งแต่ (เพชร)
            <input type="number" min={2} value={big} onChange={(e) => setBig(e.target.value)} onBlur={commitNumbers} />
          </label>
          <label className="field">
            ท่าทาง
            <select value={tiers.bigAction} onChange={(e) => void save({ bigAction: e.target.value as ActionName })}>
              {ACTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        </div>
      </div>
      <p className="body-copy">
        นับมูลค่ารวมของคอมโบ (เพชรต่อชิ้น × จำนวน) ถ้า Euler ไม่ส่งมูลค่ามา จะนับชิ้นละ 1 ·
        ตัวละครขอบคุณตามระดับโดยไม่พูดถึงราคาและไม่ขอของขวัญเพิ่ม
      </p>
    </section>
  );
}

export function RegularsPanel({
  state,
  command,
}: {
  state: AppState;
  command: (c: Command) => Promise<boolean>;
}) {
  const r = state.regulars;
  const save = (patch: Partial<{ enabled: boolean; regularVisits: number }>) =>
    command({
      type: "regulars",
      settings: { enabled: r.enabled, regularVisits: r.regularVisits, ...patch },
    });
  return (
    <section className="panel settings-panel">
      <div className="section-intro">
        <span className="section-icon">
          <UsersRound />
        </span>
        <div>
          <h2>จำขาประจำ</h2>
          <p>จำผู้ชมข้ามไลฟ์ในเครื่องนี้ ทักคนที่กลับมาและให้ป้ายขาประจำบนการ์ด</p>
        </div>
        <button className={`switch ${r.enabled ? "on" : ""}`} aria-pressed={r.enabled} onClick={() => void save({ enabled: !r.enabled })}>
          <span />
        </button>
      </div>
      <label className="field">
        นับเป็นขาประจำเมื่อมาครบ
        <select value={r.regularVisits} disabled={!r.enabled} onChange={(e) => void save({ regularVisits: Number(e.target.value) })}>
          {[2, 3, 5, 10].map((v) => <option key={v} value={v}>{v} ไลฟ์</option>)}
        </select>
      </label>
      <div className="host-memory-row">
        <span>
          จำไว้ {r.known.toLocaleString()} คน · ขาประจำ {r.regulars.toLocaleString()} คน · เก็บในเครื่อง ไม่ส่งออกไลฟ์
        </span>
        <button
          className="text-button"
          disabled={!r.known}
          onClick={() => {
            if (window.confirm("ลืมรายชื่อผู้ชมทั้งหมด? ย้อนกลับไม่ได้"))
              void command({ type: "forgetViewers" });
          }}
        >
          ลืมผู้ชมทั้งหมด
        </button>
      </div>
      <p className="body-copy">
        นับ 1 ไลฟ์ต่อการมาที่ห่างกันเกิน 3 ชั่วโมง · จำได้สูงสุด 3,000 คนล่าสุด · ใช้กับเหตุการณ์จริงจาก Euler
        และเหตุการณ์ทดสอบในหน้า Debug
      </p>
    </section>
  );
}
