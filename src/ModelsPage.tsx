import { useState } from "react";
import {
  Check,
  FolderOpen,
  Package,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import type { ActionName, AppState, Command, ModelPlayback } from "./shared";
import { EMOTIONS, EMOTION_LABELS, guessEmotionMappings } from "./emotion";
import { SceneFrame } from "./SceneFrame";
const labels: Record<ActionName, string> = {
  neutral: "ปกติ",
  wave: "โบกมือ",
  heart: "หัวใจ",
  happy: "ดีใจ",
  surprised: "ตกใจ",
};
export function ModelsPage({
  state,
  command,
  notify,
}: {
  state: AppState;
  command: (command: Command) => Promise<boolean>;
  notify: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const selected = state.avatar.models.find(
    (m) => m.id === state.avatar.selectedId,
  );
  const importModels = async () => {
    setBusy(true);
    try {
      const result = await window.dobby.importModels();
      if (result.imported)
        notify(
          `เพิ่มหรืออัปเดต ${result.imported} โมเดลแล้ว${result.errors.length ? ` · มี ${result.errors.length} ชุดที่ต้องตรวจไฟล์` : ""}`,
        );
      else if (result.errors.length) notify(result.errors[0]);
    } catch {
      notify("นำเข้าโมเดลไม่สำเร็จ ตรวจไฟล์และโฟลเดอร์");
    } finally {
      setBusy(false);
    }
  };
  const importCore = async () => {
    try {
      if (await window.dobby.importCore())
        notify("พร้อมใช้ Cubism Core ในเครื่องแล้ว");
    } catch {
      notify("เลือกไฟล์ live2dcubismcore.min.js จาก Cubism SDK");
    }
  };
  const options: ModelPlayback[] = selected
    ? [
        ...selected.motions.map((m) => ({
          kind: "motion" as const,
          name: m.group,
          index: m.index,
        })),
        ...selected.expressions.map((name) => ({
          kind: "expression" as const,
          name,
        })),
      ]
    : [];
  return (
    <div className="models-layout">
      <section className="panel model-library">
        <div className="panel-heading">
          <h2>
            <Package size={16} />
            คลังโมเดล{" "}
            <span className="count-badge">{state.avatar.models.length}</span>
          </h2>
          <button
            className="text-button"
            disabled={busy}
            onClick={importModels}
          >
            <FolderOpen size={14} />
            {busy ? "กำลังนำเข้า…" : "นำเข้า"}
          </button>
        </div>
        <div className="model-library-list">
          <button
            className={`model-card ${!selected ? "selected" : ""}`}
            onClick={() => command({ type: "selectModel", id: null })}
          >
            <span className="model-symbol">✦</span>
            <div>
              <b>Dobby</b>
              <small>ตัวละครตัวอย่าง</small>
            </div>
            {!selected && <Check size={15} />}
          </button>
          {state.avatar.models.map((model) => (
            <button
              key={model.id}
              className={`model-card ${model.id === selected?.id ? "selected" : ""}`}
              onClick={() => command({ type: "selectModel", id: model.id })}
            >
              <span className="model-symbol">
                <Sparkles size={19} />
              </span>
              <div>
                <b>{model.name}</b>
                <small>
                  {model.motions.length} motions · {model.expressions.length}{" "}
                  expressions
                </small>
              </div>
              {model.id === selected?.id && <Check size={15} />}
            </button>
          ))}
        </div>
        <div className="library-note">
          รองรับชุด .model3.json พร้อมไฟล์ประกอบ
          <br />
          อ่านไฟล์ต้นฉบับอย่างเดียว
        </div>
        <button className="core-import" onClick={importCore}>
          <span
            className={`status-dot ${state.avatar.coreUrl ? "" : "amber"}`}
          />
          {state.avatar.coreUrl
            ? "Cubism Core พร้อมใช้งาน · เปลี่ยนไฟล์"
            : "เพิ่ม Cubism Core"}
        </button>
      </section>
      <div className="model-details">
        <section className="panel model-preview-panel">
          <div className="panel-heading">
            <h2>{selected?.name ?? "Dobby"}</h2>
            <span className="soft-badge">{selected ? "LIVE2D" : "DEMO"}</span>
          </div>
          <div className="model-large-preview">
            <div className="stage-grid" />
            <SceneFrame state={state} />
          </div>
        </section>
        {selected && (
          <section className="panel settings-panel model-adjustments">
            <div className="section-intro">
              <span className="section-icon">
                <Sparkles />
              </span>
              <div>
                <h2>ปรับตัวละครของคุณ</h2>
                <p>บันทึกแยกต่อโมเดล · ใช้กับ preview และ output</p>
              </div>
            </div>
            <div className="transform-controls">
              {[
                {
                  key: "scale" as const,
                  label: "ขนาด",
                  min: 0.2,
                  max: 4,
                  step: 0.05,
                  suffix: "×",
                },
                {
                  key: "x" as const,
                  label: "ตำแหน่งแนวนอน",
                  min: -100,
                  max: 100,
                  step: 1,
                  suffix: "%",
                },
                {
                  key: "y" as const,
                  label: "ตำแหน่งแนวตั้ง",
                  min: -100,
                  max: 100,
                  step: 1,
                  suffix: "%",
                },
              ].map((control) => (
                <label className="range-control" key={control.key}>
                  <span>
                    {control.label}
                    <b>
                      {selected.settings[control.key]}
                      {control.suffix}
                    </b>
                  </span>
                  <input
                    type="range"
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    value={selected.settings[control.key]}
                    onChange={(e) =>
                      command({
                        type: "modelSettings",
                        settings: {
                          ...selected.settings,
                          [control.key]: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <div className="model-transform-footer">
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={selected.settings.mirror}
                  onChange={(e) =>
                    command({
                      type: "modelSettings",
                      settings: {
                        ...selected.settings,
                        mirror: e.target.checked,
                      },
                    })
                  }
                />
                กลับด้านตัวละคร
              </label>
              <button
                className="text-button"
                onClick={() =>
                  command({
                    type: "modelSettings",
                    settings: {
                      ...selected.settings,
                      scale: 1,
                      x: 0,
                      y: 0,
                      mirror: false,
                    },
                  })
                }
              >
                <RotateCcw size={13} />
                จัดตำแหน่งใหม่
              </button>
            </div>
            <label className="field mouth-parameter">
              พารามิเตอร์ขยับปาก
              <input
                value={selected.settings.mouthParameter}
                maxLength={100}
                onChange={(e) => {
                  if (e.target.value)
                    void command({
                      type: "modelSettings",
                      settings: {
                        ...selected.settings,
                        mouthParameter: e.target.value,
                      },
                    });
                }}
              />
              <span className="body-copy">หากชื่อไม่ตรง ระบบจะใช้ค่าขยับปากที่โมเดลกำหนดไว้ให้อัตโนมัติ</span>
            </label>
            <h3 className="model-section-title">สีหน้าในโมเดล</h3>
            <div className="expression-chips">
              {selected.expressions.length ? (
                selected.expressions.map((name) => (
                  <button
                    className="button secondary"
                    key={name}
                    onClick={() =>
                      command({
                        type: "modelPlay",
                        selection: { kind: "expression", name },
                      })
                    }
                  >
                    {name}
                  </button>
                ))
              ) : (
                <p className="body-copy">โมเดลนี้ยังไม่มีไฟล์สีหน้า</p>
              )}
            </div>
            <h3 className="model-section-title">ท่าทางในโมเดล</h3>
            <div className="expression-chips">
              {selected.motions.length ? (
                selected.motions.map((m) => (
                  <button
                    className="button secondary"
                    key={`${m.group}:${m.index}`}
                    onClick={() =>
                      command({
                        type: "modelPlay",
                        selection: {
                          kind: "motion",
                          name: m.group,
                          index: m.index,
                        },
                      })
                    }
                  >
                    <Play size={12} />
                    {m.label}
                  </button>
                ))
              ) : (
                <p className="body-copy">โมเดลนี้ยังไม่มีไฟล์ motion</p>
              )}
            </div>
            <h3 className="model-section-title">จับคู่ Action ผู้ชม</h3>
            {(["wave", "heart", "happy", "surprised"] as ActionName[]).map(
              (action) => (
                <label className="mapping-row" key={action}>
                  {labels[action]}
                  <select
                    value={
                      selected.mappings[action]
                        ? JSON.stringify(selected.mappings[action])
                        : ""
                    }
                    onChange={(e) =>
                      command({
                        type: "modelMapping",
                        action,
                        selection: e.target.value
                          ? (JSON.parse(e.target.value) as ModelPlayback)
                          : null,
                      })
                    }
                  >
                    <option value="">ไม่ผูกกับโมเดล</option>
                    {options.map((option) => (
                      <option
                        key={JSON.stringify(option)}
                        value={JSON.stringify(option)}
                      >
                        {option.kind === "expression" ? "สีหน้า" : "ท่าทาง"} ·{" "}
                        {option.name || "Motion"}
                        {option.kind === "motion"
                          ? ` ${Number(option.index) + 1}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ),
            )}
            <h3 className="model-section-title">สีหน้าตามอารมณ์คำพูด</h3>
            <p className="body-copy">
              Auto Host เลือกอารมณ์ให้ทุกคำตอบ ถ้าไม่จับคู่ ยิ้ม/ตื่นเต้น/ซึ้ง/ประหลาดใจ
              จะใช้สีหน้าจาก Action ดีใจ/หัวใจ/ตกใจ ด้านบน
            </p>
            {selected.expressions.length > 0 && (
              <button
                className="button secondary emotion-guess"
                onClick={async () => {
                  const guess = guessEmotionMappings(selected.expressions);
                  let added = 0;
                  for (const emotion of EMOTIONS) {
                    const name = guess[emotion];
                    if (!name || selected.emotions?.[emotion]) continue;
                    if (
                      await command({
                        type: "emotionMapping",
                        emotion,
                        selection: { kind: "expression", name },
                      })
                    )
                      added++;
                  }
                  notify(
                    added
                      ? `จับคู่จากชื่อสีหน้าแล้ว ${added} อารมณ์ · ตรวจและกดลองดู`
                      : "ชื่อสีหน้าของโมเดลนี้เดาอารมณ์ไม่ได้ · เลือกเองด้านล่าง",
                  );
                }}
              >
                <Sparkles size={14} />
                เดาจากชื่อสีหน้า (เฉพาะที่ยังว่าง)
              </button>
            )}
            {EMOTIONS.map((emotion) => (
              <div className="mapping-row" key={emotion}>
                <span>{EMOTION_LABELS[emotion]}</span>
                <select
                  value={
                    selected.emotions?.[emotion]
                      ? JSON.stringify(selected.emotions[emotion])
                      : ""
                  }
                  onChange={(e) =>
                    command({
                      type: "emotionMapping",
                      emotion,
                      selection: e.target.value
                        ? (JSON.parse(e.target.value) as ModelPlayback)
                        : null,
                    })
                  }
                >
                  <option value="">
                    {emotion === "neutral" ? "คืนสีหน้าปกติของโมเดล" : "ไม่ผูก"}
                  </option>
                  {options.map((option) => (
                    <option
                      key={JSON.stringify(option)}
                      value={JSON.stringify(option)}
                    >
                      {option.kind === "expression" ? "สีหน้า" : "ท่าทาง"} ·{" "}
                      {option.name || "Motion"}
                      {option.kind === "motion"
                        ? ` ${Number(option.index) + 1}`
                        : ""}
                    </option>
                  ))}
                </select>
                <button
                  className="icon-button"
                  title={`ลองอารมณ์ ${EMOTION_LABELS[emotion]}`}
                  onClick={() => command({ type: "emotion", emotion })}
                >
                  <Play size={12} />
                </button>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
