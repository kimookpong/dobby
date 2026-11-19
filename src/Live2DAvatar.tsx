import { useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import type { ActionName, AppState, AvatarState, EmotionName } from "./shared";
import type { Live2DModel } from "./vendor/cubism4.es.js";
import type { Application } from "pixi.js";
import { resolveMouthParameters, mouthParameterValue } from "./lip-sync";
import { audioLevel, useAudioLevel } from "./audio-level";

/** Without a mapping, reuse the expression already chosen for a similar viewer action. */
const EMOTION_FALLBACK: Partial<Record<EmotionName, ActionName>> = {
  happy: "happy",
  excited: "happy",
  love: "heart",
  surprised: "surprised",
};
function DemoAvatar({ action }: { action: AppState["action"]["name"] }) {
  const { level } = useAudioLevel();
  return <Avatar action={action} level={level} />;
}

let coreLoading: Promise<void> | null = null;
function loadCore(url: string) {
  if ((window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore)
    return Promise.resolve();
  if (!coreLoading)
    coreLoading = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.onload = () => resolve();
      script.onerror = () => {
        coreLoading = null;
        script.remove();
        reject(new Error("โหลด Cubism Core ไม่สำเร็จ"));
      };
      document.head.appendChild(script);
    });
  return coreLoading;
}
type Engine = {
  key: string;
  app: Application;
  model: Live2DModel;
  canvas: HTMLCanvasElement;
  fit: () => void;
  observer: ResizeObserver;
  owner: symbol | null;
  latest: { current: { avatar: AvatarState } };
  /** Rendered-frame counter for the Debug FPS readout. */
  frames: number;
};
/**
 * One renderer per window survives page switches: re-creating the WebGL context
 * and re-uploading textures on every navigation caused visible hitches.
 */
let shared: Engine | null = null;
function destroyShared() {
  const e = shared;
  shared = null;
  if (!e) return;
  e.observer.disconnect();
  e.model.destroy({ children: true, texture: true, baseTexture: true });
  e.app.destroy(true);
}
function detach(e: Engine, owner: symbol) {
  if (e.owner !== owner) return;
  e.owner = null;
  e.observer.disconnect();
  e.app.stop();
  e.model.autoUpdate = false;
  e.canvas.remove();
}
function attach(e: Engine, root: HTMLElement, owner: symbol, preview: boolean) {
  e.owner = owner;
  root.appendChild(e.canvas);
  (e.app as unknown as { resizeTo: HTMLElement }).resizeTo = root;
  e.app.ticker.maxFPS = preview ? 30 : 60;
  e.observer.disconnect();
  e.observer.observe(root);
  e.app.resize();
  e.fit();
  e.model.autoUpdate = true;
  if (document.visibilityState !== "hidden") e.app.start();
}
document.addEventListener("visibilitychange", () => {
  // Pause rendering while the window is minimized or fully hidden.
  if (!shared?.owner) return;
  if (document.visibilityState === "hidden") shared.app.stop();
  else shared.app.start();
});

export function Live2DAvatar({
  avatar,
  action,
  emotion,
  preview = true,
}: {
  avatar: AvatarState;
  action: AppState["action"];
  emotion?: AppState["emotion"];
  preview?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null),
    engine = useRef<Engine | null>(null);
  const latest = useRef({ avatar });
  latest.current = { avatar };
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const selected = avatar.models.find((m) => m.id === avatar.selectedId);
  useEffect(() => {
    if (!avatar.selectedId || !avatar.modelUrl || !element.current) return;
    const id = avatar.selectedId,
      root = element.current,
      owner = Symbol("live2d-view"),
      key = `${id}|${avatar.modelUrl}|${avatar.coreUrl}`;
    let disposed = false;
    setError("");
    if (shared && shared.key === key) {
      // Reuse the loaded model; a previous view (if still mounted) gives it up.
      shared.latest = latest;
      if (shared.owner) detach(shared, shared.owner);
      attach(shared, root, owner, preview);
      engine.current = shared;
      setLoading(false);
      const reused = shared;
      return () => {
        detach(reused, owner);
        engine.current = null;
      };
    }
    destroyShared();
    setLoading(true);
    const setup = async () => {
      try {
        if (!avatar.coreUrl)
          throw new Error("เพิ่ม Cubism Core ในหน้าจัดการโมเดลก่อน");
        await loadCore(avatar.coreUrl);
        const PIXI = await import("pixi.js");
        const { Live2DModel } = await import("./vendor/cubism4.es.js");
        if (disposed) return;
        Live2DModel.registerTicker(PIXI.Ticker);
        PIXI.Ticker.shared.maxFPS = preview ? 30 : 60;
        const app = new PIXI.Application({
          backgroundAlpha: 0,
          // Broadcast output keeps full quality; the operator preview is lighter.
          antialias: !preview,
          autoDensity: true,
          resolution: Math.min(devicePixelRatio, preview ? 1.5 : 2),
          resizeTo: root,
        });
        let model: Live2DModel;
        try {
          model = await Live2DModel.from(avatar.modelUrl!, {
            autoInteract: false,
            autoUpdate: true,
            motionPreload: "IDLE",
            autoPlay: false,
          });
        } catch (cause) {
          app.destroy(true, {
            children: true,
            texture: true,
            baseTexture: true,
          });
          throw cause;
        }
        if (disposed) {
          model.destroy({ children: true, texture: true, baseTexture: true });
          app.destroy(true);
          return;
        }
        app.stage.addChild(model);
        model.anchor.set(0.5, 0.5);
        const bounds = model.getLocalBounds();
        const canvas = app.view as HTMLCanvasElement;
        const created: Engine = {
          key,
          app,
          model,
          canvas,
          owner: null,
          latest,
          frames: 0,
          observer: new ResizeObserver(() => created.fit()),
          fit: () => {
            const parent = canvas.parentElement;
            const info = created.latest.current.avatar.models.find(
              (m) => m.id === id,
            );
            if (!info || !parent) return;
            const { width, height } = parent.getBoundingClientRect();
            const factor =
              Math.min(
                width / Math.max(bounds.width, 1),
                height / Math.max(bounds.height, 1),
              ) *
              0.9 *
              info.settings.scale;
            model.scale.set(info.settings.mirror ? -factor : factor, factor);
            model.position.set(
              width * (0.5 + info.settings.x / 100),
              height * (0.5 + info.settings.y / 100),
            );
          },
        };
        const core = model.internalModel.coreModel;
        const parameterIds = core.getModel().parameters.ids;
        // Resolve mouth parameters once per setting, not once per frame.
        let mouthKey: string | null = null;
        let mouths: { id: string; min: number; max: number }[] = [];
        let mouthLevel = 0;
        model.internalModel.on("beforeModelUpdate", () => {
          const info = created.latest.current.avatar.models.find(
            (m) => m.id === id,
          );
          const requested = info?.settings.mouthParameter ?? "ParamMouthOpenY";
          if (requested !== mouthKey) {
            mouthKey = requested;
            mouths = resolveMouthParameters(
              requested,
              parameterIds,
              model.internalModel.motionManager.lipSyncIds,
            ).map((mouth) => {
              const index = core.getParameterIndex(mouth);
              return {
                id: mouth,
                min: core.getParameterMinimumValue(index),
                max: core.getParameterMaximumValue(index),
              };
            });
          }
          const audio = audioLevel.get();
          const target = audio.active ? audio.level : 0;
          mouthLevel += (target - mouthLevel) * (target > mouthLevel ? 0.65 : 0.3);
          for (const mouth of mouths)
            core.setParameterValueById(
              mouth.id,
              mouthParameterValue(
                mouthLevel < 0.005 ? 0 : mouthLevel,
                mouth.min,
                mouth.max,
              ),
            );
        });
        // Counts real renders (ticker.FPS is unreliable with maxFPS); one increment per frame.
        app.ticker.add(() => {
          created.frames++;
        });
        shared = created;
        attach(created, root, owner, preview);
        engine.current = created;
        setLoading(false);
        window.dobby?.avatarReady(id);
      } catch (cause) {
        if (disposed) return;
        console.error("Live2D model could not load", cause);
        const message = !avatar.coreUrl
          ? "เพิ่ม Cubism Core ในหน้าจัดการโมเดลก่อน"
          : "โหลดโมเดลไม่สำเร็จ ตรวจชุดไฟล์และเวอร์ชัน Cubism Core";
        setError(message);
        setLoading(false);
        window.dobby?.avatarReady(id, message);
      }
    };
    void setup();
    return () => {
      disposed = true;
      if (engine.current) detach(engine.current, owner);
      engine.current = null;
    };
  }, [avatar.selectedId, avatar.modelUrl, avatar.coreUrl]);
  useEffect(() => {
    engine.current?.fit();
  }, [
    selected?.settings.scale,
    selected?.settings.x,
    selected?.settings.y,
    selected?.settings.mirror,
  ]);
  const play = (
    selection:
      | NonNullable<AvatarState["playback"]>
      | NonNullable<typeof selected>["mappings"]["wave"],
  ) => {
    const model = engine.current?.model;
    if (!model || !selection) return;
    void (
      selection.kind === "motion"
        ? model.motion(selection.name, selection.index ?? 0, 3)
        : model.expression(selection.name)
    ).catch(() => setError("โมเดลนี้เล่นท่าหรือสีหน้าที่เลือกไม่ได้"));
  };
  useEffect(() => {
    if (action.name !== "neutral") play(selected?.mappings[action.name]);
  }, [action.at]);
  useEffect(() => {
    if (avatar.playback) play(avatar.playback);
  }, [avatar.playback?.at]);
  // Moods change at most a few times per reply, so this does no per-frame work.
  useEffect(() => {
    const model = engine.current?.model;
    if (!emotion || !model || !selected) return;
    const mapped = selected.emotions?.[emotion.name];
    if (mapped) return play(mapped);
    const fallback = EMOTION_FALLBACK[emotion.name];
    const viaAction = fallback ? selected.mappings[fallback] : undefined;
    if (viaAction?.kind === "expression") return play(viaAction);
    if (emotion.name === "neutral")
      (
        model.internalModel.motionManager as {
          expressionManager?: { resetExpression(): void };
        }
      ).expressionManager?.resetExpression();
  }, [emotion?.at, loading]);
  if (!avatar.selectedId)
    return (
      <DemoAvatar
        action={
          action.name !== "neutral"
            ? action.name
            : (emotion && EMOTION_FALLBACK[emotion.name]) ?? "neutral"
        }
      />
    );
  return (
    <div className="live2d-view">
      <div ref={element} className="live2d-canvas" />
      {loading && (
        <div className="model-loading">กำลังโหลด {selected?.name}…</div>
      )}
      {error && <div className="model-error">{error}</div>}
      {action.name === "heart" && <div className="model-hearts">♡</div>}
    </div>
  );
}

/** Debug HUD: frame rate of this window's Live2D renderer, if one is loaded. */
let fpsSample = { frames: 0, at: 0, engine: null as Engine | null };
export function live2dStats() {
  if (!shared) return null;
  const now = performance.now();
  let fps = 0;
  if (fpsSample.engine === shared && now > fpsSample.at)
    fps = ((shared.frames - fpsSample.frames) * 1000) / (now - fpsSample.at);
  fpsSample = { frames: shared.frames, at: now, engine: shared };
  return {
    fps: shared.owner && shared.app.ticker.started ? Math.round(fps) : 0,
    maxFps: shared.app.ticker.maxFPS,
    attached: !!shared.owner,
  };
}
