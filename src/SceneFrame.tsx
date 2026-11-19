import { useState, type CSSProperties } from "react";
import type { AppState, OverlayView } from "./shared";
import { Overlay } from "./Overlay";
import { overlayView } from "./overlay-view";
import { setKeepPreview, useKeepPreview } from "./preview-pause";
import { Live2DAvatar } from "./Live2DAvatar";
type SceneState = Pick<AppState, "scene" | "avatar" | "action" | "character"> &
  Partial<Pick<AppState, "emotion" | "output">> &
  (
    | { overlayView: OverlayView }
    | Pick<AppState, "overlay" | "autoHost" | "voice">
  );
function VideoBackground({ url, preview }: { url: string; preview: boolean }) {
  const [error, setError] = useState(false);
  return (
    <>
      <video
        className="scene-background-video"
        src={url}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        onError={() => setError(true)}
      />
      {preview && error && (
        <div className="scene-media-error" role="status">
          เล่นวิดีโอนี้ไม่ได้ · ลอง MP4 (H.264) หรือ WebM (VP8/VP9)
        </div>
      )}
    </>
  );
}
export function SceneFrame({
  state,
  preview = true,
  overlay,
}: {
  state: SceneState;
  preview?: boolean;
  /** Overrides the live overlay, e.g. with a sample while adjusting placement. */
  overlay?: OverlayView | null;
}) {
  const scene = state.scene;
  const keepPreview = useKeepPreview();
  // Output window or LIVE Studio Link source is drawing the character already.
  const outputLive = preview && (state.output?.clients ?? 0) > 0;
  const previewPaused = outputLive && !keepPreview;
  // The output window receives a ready-made view; the operator app derives it locally.
  const view =
    overlay !== undefined
      ? overlay
      : "overlayView" in state
        ? state.overlayView
        : overlayView(state);
  const background =
    scene.background === "solid"
      ? scene.color
      : scene.background === "video"
        ? scene.color
        : scene.background === "gradient"
          ? `linear-gradient(145deg, ${scene.color}, ${scene.color2})`
          : "transparent";
  const style: CSSProperties & { "--scene-ratio": number } = {
    "--scene-ratio": scene.width / scene.height,
    background,
    ...(scene.background === "image" && scene.imageUrl
      ? {
          backgroundImage: `url("${scene.imageUrl}")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }
      : {}),
  };
  return (
    <div className={`scene-stage ${preview ? "is-preview" : ""}`}>
      <div
        className="scene-frame"
        data-transparent={scene.background === "transparent"}
        style={style}
      >
        {scene.background === "video" && scene.videoUrl && (
          <VideoBackground
            key={scene.videoUrl}
            url={scene.videoUrl}
            preview={preview}
          />
        )}
        {previewPaused ? (
          <div className="preview-paused">
            <b>พัก preview ชั่วคราว</b>
            <span>หน้า output กำลังแสดงตัวละครอยู่ · ประหยัด CPU/GPU ระหว่างไลฟ์</span>
            <button
              type="button"
              className="button secondary"
              onClick={() => setKeepPreview(true)}
            >
              แสดง preview
            </button>
          </div>
        ) : (
          <Live2DAvatar
            avatar={state.avatar}
            action={state.action}
            emotion={state.emotion}
            preview={preview}
          />
        )}
        {outputLive && keepPreview && (
          <button
            type="button"
            className="preview-pause-toggle"
            onClick={() => setKeepPreview(false)}
          >
            พัก preview
          </button>
        )}
        <Overlay view={view} />
      </div>
      {preview && (
        <span className="scene-resolution">
          {scene.width} × {scene.height}
        </span>
      )}
    </div>
  );
}
