import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  ImagePlus,
  Layers3,
  Monitor,
  Smartphone,
  Square,
  Video,
} from "lucide-react";
import type { AppState, Command, SceneSettings } from "./shared";
import { SceneFrame } from "./SceneFrame";
import { OverlayPanel, useOverlaySample } from "./OverlayPanel";
const presets = [
  {
    label: "TikTok แนวตั้ง",
    ratio: "9:16",
    width: 1080,
    height: 1920,
    icon: Smartphone,
  },
  { label: "แนวนอน", ratio: "16:9", width: 1920, height: 1080, icon: Monitor },
  {
    label: "สี่เหลี่ยม",
    ratio: "1:1",
    width: 1080,
    height: 1080,
    icon: Square,
  },
];
export function ScenePage({
  state,
  command,
  notify,
}: {
  state: AppState;
  command: (command: Command) => Promise<boolean>;
  notify: (message: string) => void;
}) {
  const [width, setWidth] = useState(String(state.scene.width)),
    [height, setHeight] = useState(String(state.scene.height));
  useEffect(() => {
    setWidth(String(state.scene.width));
    setHeight(String(state.scene.height));
  }, [state.scene.width, state.scene.height]);
  const update = (
    patch: Partial<Omit<SceneSettings, "imageUrl" | "videoUrl">>,
  ) => {
    const { imageUrl: _image, videoUrl: _video, ...base } = state.scene;
    return command({ type: "scene", settings: { ...base, ...patch } });
  };
  const media = async (kind: "image" | "video") => {
    try {
      if (await window.dobby.importBackground(kind))
        notify(
          kind === "video"
            ? "ตั้งวิดีโอพื้นหลังแล้ว · เล่นวนโดยปิดเสียง"
            : "ตั้งรูปพื้นหลังแล้ว · ใช้ร่วมกับ output",
        );
    } catch {
      notify(
        kind === "video"
          ? "เลือกวิดีโอ MP4 หรือ WebM ขนาดไม่เกิน 500 MB"
          : "เลือกรูป PNG, JPG หรือ WebP ขนาดไม่เกิน 20 MB",
      );
    }
  };
  const sample = useOverlaySample(state);
  return (
    <div className="scene-settings-layout">
      <div className="scene-left-column">
      <section className="panel settings-panel">
        <div className="section-intro">
          <span className="section-icon">
            <Layers3 />
          </span>
          <div>
            <h2>ฉากเดียวกับตอนไลฟ์</h2>
            <p>อัตราส่วน พื้นหลัง และตัวละคร ใช้ร่วมกับ output</p>
          </div>
        </div>
        <h3 className="model-section-title">อัตราส่วนภาพ</h3>
        <div className="ratio-presets">
          {presets.map((preset) => (
            <button
              key={preset.ratio}
              className={
                state.scene.width === preset.width &&
                state.scene.height === preset.height
                  ? "selected"
                  : ""
              }
              onClick={() =>
                update({ width: preset.width, height: preset.height })
              }
            >
              <preset.icon size={22} />
              <b>{preset.ratio}</b>
              <span>{preset.label}</span>
            </button>
          ))}
        </div>
        <div className="resolution-controls">
          <label className="field">
            กว้าง (px)
            <input
              type="number"
              min={240}
              max={3840}
              value={width}
              onChange={(e) => setWidth(e.target.value)}
            />
          </label>
          <span>×</span>
          <label className="field">
            สูง (px)
            <input
              type="number"
              min={240}
              max={3840}
              value={height}
              onChange={(e) => setHeight(e.target.value)}
            />
          </label>
          <button
            className="button secondary"
            disabled={
              Number(width) < 240 ||
              Number(height) < 240 ||
              Number(width) > 3840 ||
              Number(height) > 3840
            }
            onClick={() =>
              update({ width: Number(width), height: Number(height) })
            }
          >
            <Check size={15} />
            ใช้ขนาดนี้
          </button>
        </div>
        <h3 className="model-section-title">พื้นหลัง</h3>
        <div className="background-modes">
          {(
            [
              { id: "transparent", label: "โปร่งใส" },
              { id: "solid", label: "สีพื้น" },
              { id: "gradient", label: "ไล่สี" },
              { id: "image", label: "รูปภาพ" },
              { id: "video", label: "วิดีโอ" },
            ] as const
          ).map((mode) => (
            <button
              key={mode.id}
              className={state.scene.background === mode.id ? "selected" : ""}
              onClick={() =>
                (mode.id === "image" && !state.scene.imageUrl) ||
                (mode.id === "video" && !state.scene.videoUrl)
                  ? media(mode.id as "image" | "video")
                  : update({ background: mode.id })
              }
            >
              {mode.label}
            </button>
          ))}
        </div>
        {(state.scene.background === "solid" ||
          state.scene.background === "gradient") && (
          <div className="color-controls">
            <label>
              สีหลัก
              <input
                type="color"
                value={state.scene.color}
                onChange={(e) => update({ color: e.target.value })}
              />
              <code>{state.scene.color}</code>
            </label>
            {state.scene.background === "gradient" && (
              <label>
                สีรอง
                <input
                  type="color"
                  value={state.scene.color2}
                  onChange={(e) => update({ color2: e.target.value })}
                />
                <code>{state.scene.color2}</code>
              </label>
            )}
          </div>
        )}
        {state.scene.background === "transparent" && (
          <div className="info-note">
            ลายตารางใช้แสดงความโปร่งใสใน preview เท่านั้น ภาพ output จะโปร่งใสจริง
          </div>
        )}
        {state.scene.background === "image" && (
          <>
            <button className="button secondary" onClick={() => media("image")}>
              <ImagePlus size={15} />
              เลือกรูปพื้นหลัง
            </button>
            <p className="body-copy scene-image-note">
              รูปจะขยายเต็มฉากและครอปจากกึ่งกลาง โดยคงสัดส่วนเดิม
            </p>
          </>
        )}
        {state.scene.background === "video" && (
          <>
            <button className="button secondary" onClick={() => media("video")}>
              <Video size={15} />
              เลือกวิดีโอพื้นหลัง
            </button>
            <p className="body-copy scene-image-note">
              MP4 / WebM ไม่เกิน 500 MB · เล่นวนอัตโนมัติและปิดเสียง
              ขยายเต็มฉากโดยคงสัดส่วนและครอปจากกึ่งกลาง แนะนำ MP4 (H.264) หรือ WebM
              (VP8/VP9)
            </p>
          </>
        )}
        <div className="info-note">
          ตั้ง Link source ใน LIVE Studio เป็น {state.scene.width} ×{" "}
          {state.scene.height} เพื่อให้ตรงกับ preview นี้
        </div>
        <button
          className="button secondary scene-copy"
          onClick={async () => {
            await window.dobby.copy(state.output.url);
            notify(
              `คัดลอกลิงก์แล้ว · ตั้ง source ${state.scene.width} × ${state.scene.height}`,
            );
          }}
        >
          <Copy size={15} />
          คัดลอกลิงก์ฉากนี้
        </button>
      </section>
      <OverlayPanel state={state} command={command} sample={sample} />
      </div>
      <section className="panel scene-live-preview">
        <div className="panel-heading">
          <h2>ภาพที่จะใช้ไลฟ์</h2>
          <span className="soft-badge">
            {state.scene.width} × {state.scene.height}
          </span>
        </div>
        <div className="scene-full-preview">
          <SceneFrame state={state} overlay={sample.view} />
        </div>
        <p className="scene-preview-note">พื้นที่นอกกรอบไม่รวมอยู่ในฉากไลฟ์</p>
      </section>
    </div>
  );
}
