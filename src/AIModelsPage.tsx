import { useState } from "react";
import { BrainCircuit, Check, RefreshCw, AudioLines } from "lucide-react";
import type { AppState } from "./shared";

export function AIModelsPage({
  state,
  hostStarting,
  notify,
}: {
  state: AppState;
  hostStarting: boolean;
  notify: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const brain = state.brain;
  const locked =
    saving ||
    hostStarting ||
    state.autoHost.enabled ||
    brain.status === "loading" ||
    brain.status === "thinking";
  const run = async (action: () => Promise<void>) => {
    setSaving(true);
    try {
      await action();
    } catch (e) {
      notify(
        e instanceof Error
          ? e.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              "",
            )
          : "ตั้งค่าโมเดลไม่สำเร็จ",
      );
    } finally {
      setSaving(false);
    }
  };
  const choices = [
    {
      id: null,
      name: "Codex Voice",
      description:
        "ส่งคอมเมนต์หนึ่งครั้ง ได้คำตอบพร้อมเสียงในเซสชันเดียว เหมาะกับไลฟ์ที่ต้องการตอบทันที",
      default: false,
    },
    ...brain.models,
  ];
  return (
    <section className="panel settings-panel ai-models-panel">
      <div className="section-intro">
        <span className="section-icon">
          <BrainCircuit />
        </span>
        <div>
          <h2>เลือกโมเดลคิดคำตอบ</h2>
          <p>ใช้บัญชี Codex ที่ล็อกอินอยู่ · ไม่ต้องใช้ API key</p>
        </div>
      </div>
      <div
        className={`voice-status ${brain.status === "error" ? "is-error" : ""}`}
        role="status"
      >
        {brain.message}
      </div>
      <div className="ai-model-toolbar">
        <button
          className="button secondary"
          disabled={locked}
          onClick={() => run(() => window.dobby.brainPrepare())}
        >
          <RefreshCw size={15} />
          {brain.status === "loading" ? "กำลังโหลดโมเดล…" : "โหลดโมเดลจาก Codex"}
        </button>
        <span className="soft-badge">{brain.models.length} โมเดล</span>
      </div>
      <p className="body-copy">
        เลือกอยู่:{" "}
        <strong>
          {brain.models.find((m) => m.id === brain.selectedId)?.name ??
            brain.selectedId ??
            "Codex Voice"}
        </strong>
      </p>
      {state.autoHost.enabled && (
        <div className="info-note">
          หยุด Auto Host ก่อนเปลี่ยนโมเดล แล้วกดเริ่มใหม่เพื่อใช้โมเดลที่เลือก
        </div>
      )}
      <div
        className="ai-model-cards"
        role="radiogroup"
        aria-label="โมเดล AI ที่ใช้คิดคำตอบ"
      >
        {choices.map((model) => (
          <button
            key={model.id ?? "realtime"}
            type="button"
            role="radio"
            aria-checked={brain.selectedId === model.id}
            aria-label={`โมเดล ${model.name}`}
            className={`ai-model-card ${brain.selectedId === model.id ? "selected" : ""}`}
            disabled={locked}
            onClick={() => run(() => window.dobby.brainSelect(model.id))}
          >
            <span className="ai-model-symbol">
              {model.id ? <BrainCircuit size={23} /> : <AudioLines size={23} />}
            </span>
            <span className="ai-model-details">
              <strong>{model.name}</strong>
              <small>{model.description}</small>
              <span className="ai-model-id">
                {model.id ?? "เซสชันสนทนาเสียง"}
              </span>
            </span>
            {brain.selectedId === model.id ? (
              <Check className="ai-model-check" size={18} />
            ) : model.default ? (
              <span className="soft-badge">ค่าเริ่มต้นบัญชี</span>
            ) : null}
          </button>
        ))}
      </div>
      {!brain.models.length && (
        <p className="body-copy">กดโหลดโมเดลเพื่อดูรายชื่อที่บัญชีนี้ใช้ได้</p>
      )}
      <div className="info-note">
        ตั้งภาษาคำตอบในหน้าคาแรกเตอร์และเลือกเสียงในหน้าเสียงพูด
        โมเดลข้อความจะเขียนคำตอบก่อนส่งให้ Codex Voice อ่านเป็นอีกขั้น
      </div>
      {brain.activeModel && (
        <p className="body-copy">โมเดลที่ใช้คิดคำตอบล่าสุด: {brain.activeModel}</p>
      )}
    </section>
  );
}
