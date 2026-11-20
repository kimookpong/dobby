import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  AudioLines,
  Bell,
  Bug,
  Blocks,
  BrainCircuit,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Copy,
  ExternalLink,
  Gift,
  Heart,
  LayoutDashboard,
  Link2,
  MessageCircle,
  Mic,
  Pause,
  Play,
  Plus,
  Radio,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Unplug,
  UserRound,
  Users,
  Volume2,
  Waves,
  X,
  Zap,
} from "lucide-react";
import type {
  OverlayView,
  ActionName,
  AppState,
  Command,
  EventType,
  VoiceSettings,
} from "./shared";
import { SceneFrame } from "./SceneFrame";
import { DebugPage, DebugHud } from "./DebugPage";
import { GiftTierPanel, RegularsPanel } from "./AudiencePanels";
import { audioLevel, createAudioReporter, useAudioLevel } from "./audio-level";
import { ScenePage } from "./ScenePage";
import { ModelsPage } from "./ModelsPage";
import { VoicePage } from "./VoicePage";
import { useCodexVoice } from "./useCodexVoice";
import { AutoHostPanel } from "./AutoHostPanel";
import { AIModelsPage } from "./AIModelsPage";
import dobbyMascot from "../assets/branding/dobby-original-elf-ai-v1.png";
import "./style.css";

const eventLabels: Record<EventType, string> = {
  comment: "คอมเมนต์",
  gift: "ของขวัญ",
  like: "ไลก์",
  follow: "ติดตาม",
  join: "เข้าห้อง",
};
const actionLabels: Record<ActionName, string> = {
  neutral: "ปกติ",
  wave: "โบกมือ",
  heart: "หัวใจ",
  happy: "ดีใจ",
  surprised: "ตกใจ",
};
const eventIcons = {
  comment: MessageCircle,
  gift: Gift,
  like: Heart,
  follow: UserRound,
  join: Users,
};
type Page =
  | "console"
  | "character"
  | "models"
  | "ai"
  | "scene"
  | "voice"
  | "actions"
  | "connections"
  | "debug"
  | "guide";
const format = (n: number) =>
  new Intl.NumberFormat("en", {
    notation: n >= 10000 ? "compact" : "standard",
  }).format(n);

function Output() {
  const [state, setState] = useState<
    | (Pick<
        AppState,
        "character" | "action" | "audio" | "paused" | "avatar" | "scene" | "emotion"
      > & { overlayView: OverlayView })
    | null
  >(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    document.body.classList.add("output-body");
    document.title = "Dobby · LIVE output";
    const stream = new EventSource(`/output/events${location.search}`);
    stream.onmessage = (e) => {
      try {
        setState(JSON.parse(e.data));
        setConnected(true);
      } catch {
        setConnected(false);
      }
    };
    stream.addEventListener("audio", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        audioLevel.set(Number(data.level) || 0, !!data.active);
      } catch {
        /* Ignore malformed level frames. */
      }
    });
    stream.onerror = () => setConnected(false);
    return () => stream.close();
  }, []);
  if (!state || !connected)
    return <div className="output-wait">รอเชื่อมต่อ Dobby…</div>;
  return <SceneFrame state={state} preview={false} />;
}

function StageStatus({ paused }: { paused: boolean }) {
  const audio = useAudioLevel();
  return (
    <>
      {audio.active && audio.level > 0.06
        ? "กำลังขยับปากตามเสียง"
        : paused
          ? "พัก Action"
          : "พร้อมทักทายผู้ชม"}
    </>
  );
}
function AudioBars() {
  const { level } = useAudioLevel();
  return (
    <div className="audio-bars">
      {Array.from({ length: 28 }, (_, i) => (
        <i key={i} className={level * 28 > i ? "lit" : ""} />
      ))}
    </div>
  );
}

function useAudio(notify: (text: string) => void) {
  const [active, setActive] = useState(false),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [device, setDevice] = useState("");
  const report = useRef(createAudioReporter()).current;
  const resources = useRef<{
    stream: MediaStream;
    context: AudioContext;
    frame: number;
  } | null>(null);
  const stop = () => {
    const r = resources.current;
    if (r) {
      clearInterval(r.frame);
      r.stream.getTracks().forEach((t) => t.stop());
      void r.context.close();
      resources.current = null;
    }
    setActive(false);
    report(0, false);
  };
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: device ? { deviceId: { exact: device } } : true,
        video: false,
      });
      const context = new AudioContext(),
        analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const r = { stream, context, frame: 0 };
      resources.current = r;
      setDevices(
        (await navigator.mediaDevices.enumerateDevices()).filter(
          (d) => d.kind === "audioinput",
        ),
      );
      setActive(true);
      const values = new Float32Array(analyser.fftSize);
      const sample = () => {
        if (resources.current !== r) return;
        analyser.getFloatTimeDomainData(values);
        let sum = 0;
        for (let i = 0; i < values.length; i++) sum += values[i] * values[i];
        report(Math.min(1, Math.sqrt(sum / values.length) * 7), true);
      };
      // Timer, not animation frames: keeps working while the window is covered.
      sample();
      r.frame = window.setInterval(sample, 30);
      stream.getTracks()[0].onended = stop;
    } catch {
      stop();
      notify("เปิดแหล่งเสียงไม่ได้ ตรวจสิทธิ์ไมโครโฟนหรืออุปกรณ์ที่เลือก");
    }
  };
  useEffect(
    () => () => {
      const r = resources.current;
      if (r) {
        clearInterval(r.frame);
        r.stream.getTracks().forEach((t) => t.stop());
        void r.context.close();
      }
    },
    [],
  );
  return { active, devices, device, setDevice, start, stop };
}

function App() {
  const [state, setState] = useState<AppState | null>(null),
    [page, setPage] = useState<Page>("console"),
    [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const notify = (message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  };
  const audio = useAudio(notify);
  const voicePlayer = useCodexVoice(state?.voice, notify);
  const [hostStarting, setHostStarting] = useState(false);
  const hostAttempt = useRef(0);
  /** Automatic voice recovery: bumped to cancel a pending reconnect. */
  const recovery = useRef({ running: false, generation: 0 });
  const stopHost = async () => {
    recovery.current.generation++;
    hostAttempt.current++;
    setHostStarting(false);
    await window.dobby.autoHost(false);
    await voicePlayer.disconnect();
  };
  const startHost = async (settings?: VoiceSettings): Promise<boolean> => {
    if (!state || hostStarting || state.autoHost.enabled) return false;
    const attempt = ++hostAttempt.current;
    setHostStarting(true);
    try {
      await window.dobby.autoHost(false);
      await voicePlayer.disconnect();
      if (attempt !== hostAttempt.current) return false;
      const connected = await voicePlayer.connect(
        settings ?? state.voice.settings,
        false,
        "host",
      );
      if (attempt !== hostAttempt.current) return false;
      if (connected) await window.dobby.autoHost(true);
      return connected;
    } catch (e) {
      if (attempt === hostAttempt.current) {
        await voicePlayer.disconnect();
        notify(
          e instanceof Error
            ? e.message.replace(
                /^Error invoking remote method '[^']+': Error: /,
                "",
              )
            : "เริ่ม Auto Host ไม่สำเร็จ",
        );
      }
      return false;
    } finally {
      if (attempt === hostAttempt.current) setHostStarting(false);
    }
  };
  /** Pressing Start yourself cancels any automatic reconnect in progress. */
  const manualStartHost = (settings?: VoiceSettings) => {
    recovery.current.generation++;
    return startHost(settings);
  };
  const startHostRef = useRef(startHost);
  startHostRef.current = startHost;
  // When the voice session drops mid-live (session limit, network), reconnect
  // and resume Auto Host by itself: 3 tries, waiting 2s, 5s, then 10s.
  useEffect(() => {
    const host = state?.autoHost;
    if (!host || host.enabled || host.status !== "error" || !host.recoverable) return;
    if (recovery.current.running) return;
    recovery.current.running = true;
    const generation = recovery.current.generation;
    void (async () => {
      try {
        for (const [i, delay] of [2000, 5000, 10_000].entries()) {
          notify(`เสียงหลุด · กำลังเชื่อมใหม่อัตโนมัติ (ครั้งที่ ${i + 1}/3)`);
          await new Promise((r) => setTimeout(r, delay));
          if (generation !== recovery.current.generation) return;
          if (await startHostRef.current()) {
            notify("เชื่อมเสียงใหม่แล้ว · Auto Host ทำงานต่อ");
            return;
          }
        }
        notify("เชื่อมเสียงใหม่ไม่สำเร็จ 3 ครั้ง · ตรวจเครือข่ายแล้วกดเริ่ม Auto Host เอง");
      } finally {
        recovery.current.running = false;
      }
    })();
  }, [state?.autoHost.enabled, state?.autoHost.status, state?.autoHost.recoverable]);
  useEffect(() => {
    if (state?.voice.status === "connected" && audio.active) audio.stop();
  }, [state?.voice.status, audio.active]);
  useEffect(() => {
    void window.dobby
      .state()
      .then(setState)
      .catch(() => notify("โหลด Dobby ไม่สำเร็จ"));
    return window.dobby.subscribe(setState);
  }, []);
  const command = async (value: Command) => {
    try {
      setState(await window.dobby.command(value));
      return true;
    } catch (e) {
      notify(
        e instanceof Error
          ? e.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              "",
            )
          : "ดำเนินการไม่สำเร็จ",
      );
      return false;
    }
  };
  const copyOutput = async () => {
    if (state) {
      await window.dobby.copy(state.output.url);
      notify(
        `คัดลอกลิงก์แล้ว · ตั้ง Link source ${state.scene.width} × ${state.scene.height}`,
      );
    }
  };
  if (!state)
    return (
      <div className="loading">
        <Sparkles />
        <span>กำลังเปิด Dobby…</span>
      </div>
    );
  const tabs: {
    id: Page;
    label: string;
    en: string;
    icon: typeof LayoutDashboard;
  }[] = [
    {
      id: "console",
      label: "ห้องควบคุม",
      en: "CONTROL ROOM",
      icon: LayoutDashboard,
    },
    { id: "character", label: "คาแรกเตอร์", en: "CHARACTER", icon: UserRound },
    { id: "ai", label: "โมเดล AI", en: "AI MODELS", icon: BrainCircuit },
    {
      id: "models",
      label: "โมเดล Live2D",
      en: "MODEL LIBRARY",
      icon: Sparkles,
    },
    {
      id: "scene",
      label: "ฉากไลฟ์",
      en: "LIVE SCENE",
      icon: SlidersHorizontal,
    },
    { id: "voice", label: "เสียงพูด", en: "CHARACTER VOICE", icon: AudioLines },
    { id: "actions", label: "Action ผู้ชม", en: "INTERACTIONS", icon: Zap },
    {
      id: "connections",
      label: "การเชื่อมต่อ",
      en: "CONNECTIONS",
      icon: Blocks,
    },
    { id: "debug", label: "Debug / ทดสอบ", en: "DEBUG", icon: Bug },
  ];
  const current = tabs.find((t) => t.id === page);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <img src={dobbyMascot} alt="Dobby AI elf" />
          </span>
          <span>
            dobby<span className="brand-dot">.</span>
          </span>
          <small>ALPHA</small>
        </div>
        <div className="workspace-label">YOUR LIVE COMPANION</div>
        <nav>
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`nav-item ${page === t.id ? "selected" : ""}`}
              onClick={() => setPage(t.id)}
            >
              <t.icon size={19} />
              <span>{t.label}</span>
              {page === t.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="mini-profile">
            <span className="mini-bot">✦</span>
            <div>
              <b>{state.character.name}</b>
              <small>ผู้ช่วยประจำไลฟ์ของคุณ</small>
            </div>
            <span className="status-dot" />
          </div>
          <button
            className={`nav-item ${page === "guide" ? "selected" : ""}`}
            onClick={() => setPage("guide")}
          >
            <CircleHelp size={18} />
            คู่มือเริ่มต้น
            <ArrowUpRight size={15} />
          </button>
          <div className="version">
            DOBBY DESKTOP <span>v0.8.2</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <b>{page === "guide" ? "GETTING STARTED" : current?.en}</b>
          </div>
          <div className="topbar-right">
            <span
              className={`tiny-status ${state.euler.status === "connected" ? "green" : ""}`}
            >
              <i />
              {state.euler.status === "connected"
                ? "Euler connected"
                : "Local workspace"}
            </span>
            <span className="topbar-divider" />
            <span className="user-avatar">D</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">MAKE YOUR CHARACTER COME ALIVE</div>
              <h1>
                {page === "console"
                  ? "ห้องควบคุมไลฟ์"
                  : page === "guide"
                    ? "เริ่มไลฟ์กับ Dobby"
                    : current?.label}
                <span className="mode-badge">
                  {state.euler.status === "connected"
                    ? "รับเหตุการณ์จริง"
                    : "โหมดทดลอง"}
                </span>
              </h1>
              <p>
                {page === "console"
                  ? "ตัวละครของคุณ ทุกปฏิสัมพันธ์ ในที่เดียว"
                  : page === "character"
                    ? "ให้บุคลิกที่เป็นคุณกับผู้ช่วยประจำไลฟ์"
                    : page === "actions"
                      ? "เปลี่ยนทุกปฏิสัมพันธ์ให้เป็นโมเมนต์พิเศษ"
                      : page === "guide"
                        ? "เชื่อมตัวละคร เสียง และผู้ชมเข้าด้วยกัน"
                        : page === "ai"
                          ? "เลือกโมเดล AI ที่คิดคำตอบให้ตัวละคร"
                          : page === "models"
                            ? "เลือกโมเดลและปรับการแสดงผลของตัวละคร"
                            : page === "scene"
                              ? "จัดพื้นหลังและอัตราส่วนให้ตรงกับไลฟ์ของคุณ"
                              : page === "voice"
                                ? "เลือกเสียง Codex ให้ตัวละคร โดยไม่ใช้ API key"
                                : page === "debug"
                                  ? "วัดประสิทธิภาพและซ้อมไลฟ์ก่อนออกอากาศจริง"
                                  : "เชื่อมเครื่องมือที่ทำให้ Dobby มีชีวิต"}
              </p>
            </div>
            <button className="button primary" onClick={copyOutput}>
              <Link2 size={16} />
              ลิงก์สำหรับ LIVE Studio
              <ArrowUpRight size={16} />
            </button>
          </div>
          {page === "console" && (
            <>
              <AutoHostPanel
                state={state}
                busy={hostStarting}
                onStart={manualStartHost}
                onStop={stopHost}
              />
              <div className="stats-row">
                {[
                  {
                    label: "เหตุการณ์ทั้งหมด",
                    value: state.stats.events,
                    icon: Activity,
                    note: "ในรอบที่เปิดแอป",
                  },
                  {
                    label: "คอมเมนต์",
                    value: state.stats.comments,
                    icon: MessageCircle,
                    note: `${state.queue.length} งานในคิว`,
                  },
                  {
                    label: "ของขวัญ",
                    value: state.stats.gifts,
                    icon: Gift,
                    note: "นับจำนวนหลังกันซ้ำ",
                  },
                  {
                    label: "หัวใจจากผู้ชม",
                    value: state.stats.likes,
                    icon: Heart,
                    note: "พร้อมสร้างโมเมนต์ดี ๆ",
                  },
                ].map((s, i) => (
                  <div className={`stat-card stat-${i}`} key={s.label}>
                    <div className="stat-label">
                      {s.label}
                      <s.icon size={17} />
                    </div>
                    <strong>{format(s.value)}</strong>
                    <small>{s.note}</small>
                  </div>
                ))}
              </div>
              <div className="console-grid">
                <section className="panel avatar-panel">
                  <div className="panel-heading">
                    <h2>
                      <Sparkles size={16} />
                      ตัวละครของคุณ
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => setPage("character")}
                    >
                      ปรับแต่ง
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <div className="avatar-stage">
                    <div className="stage-grid" />
                    <div className="stage-orbit orbit-1" />
                    <div className="stage-orbit orbit-2" />
                    <span className="stage-label">
                      <span className="status-dot" />
                      <StageStatus paused={state.paused} />
                    </span>
                    <span className="stage-corner">
                      <span />
                      PREVIEW
                    </span>
                    <SceneFrame state={state} />
                    <div className="stage-caption">
                      <b>
                        {state.character.name}
                        <span>✦</span>
                      </b>
                      <small>
                        {state.avatar.selectedId
                          ? `Live2D · ${state.avatar.models.find((m) => m.id === state.avatar.selectedId)?.name ?? ""}`
                          : "ตัวละครตัวอย่าง · เลือกโมเดล Live2D ของคุณได้"}
                      </small>
                    </div>
                    <button
                      className="stage-output"
                      title="เปิดหน้าต่าง output"
                      onClick={() => window.dobby.openOutput()}
                    >
                      <ExternalLink size={16} />
                    </button>
                  </div>
                  <div className="action-bar">
                    <span>ลองเล่นท่าทาง</span>
                    <div>
                      {(
                        ["wave", "heart", "happy", "surprised"] as ActionName[]
                      ).map((a) => (
                        <button
                          key={a}
                          className={state.action.name === a ? "active" : ""}
                          onClick={() => command({ type: "action", action: a })}
                        >
                          {a === "wave"
                            ? "✋"
                            : a === "heart"
                              ? "♡"
                              : a === "happy"
                                ? "☺"
                                : "✧"}
                          <span>{actionLabels[a]}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
                <section className="panel events-panel">
                  <div className="panel-heading">
                    <h2>
                      <Radio size={16} />
                      จากผู้ชม
                    </h2>
                    <span className="count-badge">{state.events.length}</span>
                  </div>
                  <div className="event-filters">
                    <span className="active">ทั้งหมด</span>
                    <small>เหตุการณ์ล่าสุด</small>
                    <span className="event-connection">
                      <i />
                      {state.euler.status === "connected" ? "LIVE" : "DEMO"}
                    </span>
                  </div>
                  <div className="events-list">
                    {!state.events.length ? (
                      <div className="empty-state">
                        <div className="empty-icon">
                          <Waves size={28} />
                        </div>
                        <h3>ทุกโมเมนต์เริ่มจากผู้ชม</h3>
                        <p>
                          ลองส่งเหตุการณ์จำลองด้านล่าง
                          <br />
                          หรือเชื่อม Euler เพื่อรับจากไลฟ์จริง
                        </p>
                      </div>
                    ) : (
                      state.events.slice(0, 12).map((e) => {
                        const Icon = eventIcons[e.type];
                        return (
                          <div
                            className={`event-row event-${e.type}`}
                            key={`${e.source}:${e.id}`}
                          >
                            <div className="event-avatar">
                              {e.name.slice(0, 1)}
                              <span>
                                <Icon size={9} />
                              </span>
                            </div>
                            <div className="event-body">
                              <div>
                                <b>{e.name}</b>
                                <small>
                                  {new Date(e.timestamp).toLocaleTimeString(
                                    "th-TH",
                                    { hour: "2-digit", minute: "2-digit" },
                                  )}
                                </small>
                              </div>
                              <p>
                                {e.type === "gift"
                                  ? `ส่ง ${e.text} ×${e.count}`
                                  : e.text}
                              </p>
                            </div>
                            {e.source === "demo" && (
                              <span className="demo-tag">ทดลอง</span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                  <div className="simulation">
                    <span>
                      <FlaskIcon />
                      ทดลองปฏิสัมพันธ์ <small>ไม่ส่งเข้า TikTok</small>
                    </span>
                    <div>
                      {(
                        ["comment", "gift", "like", "follow"] as EventType[]
                      ).map((t) => {
                        const Icon = eventIcons[t];
                        return (
                          <button
                            title={`จำลอง${eventLabels[t]}`}
                            disabled={
                              state.euler.status === "connected" &&
                              !(state.debug.enabled && state.debug.injectOnLive)
                            }
                            key={t}
                            onClick={() =>
                              command({ type: "simulate", eventType: t })
                            }
                          >
                            <Icon size={15} />
                            {eventLabels[t]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>
              </div>
              <div className="bottom-grid">
                <section className="panel queue-panel">
                  <div className="panel-heading">
                    <h2>
                      <MessageCircle size={16} />
                      คิวคำตอบ
                      <span className="count-badge">
                        {state.queue.length}/20
                      </span>
                    </h2>
                    <div className="inline-actions">
                      <button
                        className={`text-button ${state.paused ? "mint" : ""}`}
                        onClick={() =>
                          command({ type: "pause", paused: !state.paused })
                        }
                      >
                        {state.paused ? (
                          <Play size={13} />
                        ) : (
                          <Pause size={13} />
                        )}{" "}
                        {state.paused ? "ทำงานต่อ" : "พัก Action"}
                      </button>
                      <button
                        className="text-button"
                        onClick={() => command({ type: "clearQueue" })}
                      >
                        ล้างคิว
                      </button>
                    </div>
                  </div>
                  <div className="queue-content">
                    {!state.queue.length ? (
                      <div className="queue-empty">
                        <CheckCheck size={24} />
                        <div>
                          <b>ยังไม่มีคำถามรออยู่</b>
                          <p>คอมเมนต์ที่เข้าเงื่อนไขจะมารวมกันที่นี่</p>
                        </div>
                      </div>
                    ) : (
                      state.queue.slice(0, 4).map((job, i) => (
                        <div className="queue-row" key={job.id}>
                          <span className="queue-number">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <div>
                            <b>
                              {job.name}
                              <small>
                                {job.status === "claimed"
                                  ? "Codex จองงานแล้ว"
                                  : "รอเลือกตอบ"}
                              </small>
                            </b>
                            <p>{job.text}</p>
                          </div>
                          <button
                            className="icon-button"
                            title="คัดลอกคำถามไปคุยกับ Codex"
                            onClick={async () => {
                              await window.dobby.copy(
                                `${job.name} ถาม: ${job.text}`,
                              );
                              notify("คัดลอกคำถามแล้ว นำไปถามใน Codex Voice ได้");
                            }}
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            className="icon-button"
                            title="ข้ามคำถาม"
                            onClick={() =>
                              command({ type: "removeJob", id: job.id })
                            }
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="queue-footnote">
                    <span className="status-dot amber" />
                    {state.autoHost.enabled
                      ? state.autoHost.message
                      : "กดเริ่มตอบไลฟ์อัตโนมัติเพื่อตอบผู้ชมด้วยเสียง"}
                  </div>
                </section>
                <section className="panel readiness">
                  <div className="panel-heading">
                    <h2>
                      <Link2 size={16} />
                      พร้อมเชื่อมต่อ
                    </h2>
                    <button
                      className="icon-button"
                      title="ตั้งค่าการเชื่อมต่อ"
                      onClick={() => setPage("connections")}
                    >
                      <Settings2 size={16} />
                    </button>
                  </div>
                  <ConnectionRow
                    name="Codex"
                    detail={
                      state.codex.lastSeen
                        ? "มีการเรียกเครื่องมือแล้ว"
                        : "รอเชื่อมผ่าน MCP"
                    }
                    on={!!state.codex.lastSeen}
                  />
                  <ConnectionRow
                    name="Euler Stream"
                    detail={
                      state.euler.status === "connected"
                        ? `@${state.euler.username}`
                        : "รอเชื่อมช่อง TikTok"
                    }
                    on={state.euler.status === "connected"}
                  />
                  <ConnectionRow
                    name="Broadcast output"
                    detail={
                      state.output.clients
                        ? `${state.output.clients} หน้าจอเชื่อมอยู่`
                        : "เพิ่มลิงก์ใน LIVE Studio"
                    }
                    on={state.output.clients > 0}
                  />
                  <button
                    className="setup-link"
                    onClick={() => setPage("connections")}
                  >
                    ตั้งค่าการเชื่อมต่อ
                    <ArrowUpRight size={15} />
                  </button>
                </section>
              </div>
            </>
          )}
          {page === "debug" && <DebugPage state={state} command={command} />}
          {page === "scene" && (
            <ScenePage state={state} command={command} notify={notify} />
          )}
          {page === "models" && (
            <ModelsPage state={state} command={command} notify={notify} />
          )}
          {page === "ai" && (
            <AIModelsPage
              state={state}
              hostStarting={hostStarting}
              notify={notify}
            />
          )}
          {page === "character" && (
            <CharacterPage state={state} command={command} notify={notify} />
          )}
          {page === "actions" && (
            <div className="actions-page">
            <section className="panel settings-panel">
              <div className="section-intro">
                <span className="section-icon">
                  <Zap />
                </span>
                <div>
                  <h2>ให้ผู้ชมสร้างโมเมนต์</h2>
                  <p>
                    ตั้งกติกาว่าแต่ละเหตุการณ์จะทำอะไร ท่าทางทำงานได้ทันที ส่วนคำตอบจะเข้าคิว
                  </p>
                </div>
              </div>
              {state.rules.map((rule) => {
                const Icon = eventIcons[rule.type];
                const update = (patch: Partial<typeof rule>) =>
                  command({
                    type: "rules",
                    rules: state.rules.map((r) =>
                      r.type === rule.type ? { ...r, ...patch } : r,
                    ),
                  });
                return (
                  <div className="rule-row" key={rule.type}>
                    <div className={`rule-type event-${rule.type}`}>
                      <Icon size={20} />
                      <div>
                        <b>{eventLabels[rule.type]}</b>
                        <small>{rule.type.toUpperCase()}</small>
                      </div>
                    </div>
                    <label className="rule-select">
                      ท่าทาง
                      <select
                        value={rule.action}
                        onChange={(e) =>
                          update({
                            action: e.target.value as typeof rule.action,
                          })
                        }
                      >
                        <option value="none">ไม่เล่นท่า</option>
                        {Object.entries(actionLabels).map(([id, label]) => (
                          <option value={id} key={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={rule.enqueue}
                        onChange={(e) => update({ enqueue: e.target.checked })}
                      />
                      เข้าคิวตอบ
                    </label>
                    <button
                      aria-label={`${rule.enabled ? "ปิด" : "เปิด"} ${eventLabels[rule.type]}`}
                      aria-pressed={rule.enabled}
                      className={`switch ${rule.enabled ? "on" : ""}`}
                      onClick={() => update({ enabled: !rule.enabled })}
                    >
                      <span />
                    </button>
                  </div>
                );
              })}
              <div className="info-note">
                <ShieldCheck size={17} />
                กติกามีการกันเหตุการณ์ซ้ำและจำกัดความถี่ เพื่อให้ไลฟ์ดำเนินต่ออย่างลื่นไหล
              </div>
            </section>
            <div className="connections-grid">
              <GiftTierPanel state={state} command={command} />
              <RegularsPanel state={state} command={command} />
            </div>
            </div>
          )}
          {page === "voice" && (
            <VoicePage
              state={state}
              player={voicePlayer}
              notify={notify}
              hostStarting={hostStarting}
              startHost={manualStartHost}
              stopHost={stopHost}
            />
          )}
          {page === "connections" && (
            <Connections
              state={state}
              command={command}
              notify={notify}
              audio={audio}
              copyOutput={copyOutput}
            />
          )}
          {page === "guide" && (
            <section className="panel settings-panel guide">
              <div className="section-intro">
                <span className="section-icon">
                  <Sparkles />
                </span>
                <div>
                  <h2>จากตัวละคร สู่ไลฟ์ของคุณ</h2>
                  <p>เริ่มทดสอบในเครื่องก่อนเปิดไลฟ์จริง</p>
                </div>
              </div>
              {[
                {
                  title: "เลือกบุคลิกของ Dobby",
                  text: "ตั้งชื่อ บุคลิก และวิธีพูดในหน้าคาแรกเตอร์ โหลดโปรไฟล์ผ่าน MCP เพื่อใช้กับบทสนทนา Codex",
                  page: "character",
                },
                {
                  title: "เชื่อม Codex และตัวละคร",
                  text: "คัดลอกการตั้งค่า MCP ไปเพิ่มใน Codex แล้วเปิดแชตใหม่ จากนั้นเลือกโมเดล .model3.json ในคลังโมเดล Live2D ของ Dobby",
                  page: "connections",
                },
                {
                  title: "เพิ่มแหล่งภาพใน TikTok LIVE Studio",
                  text: "ใช้ลิงก์ output ของ Dobby เป็น Link source หรือจับหน้าต่าง Preview ตั้งฉากแนวตั้ง 1080 × 1920 และเพิ่มเสียงตัวละครแยก",
                  page: "connections",
                },
                {
                  title: "เชื่อมผู้ชมผ่าน Euler Stream",
                  text: "กรอกชื่อช่องและ API key ในแอปแล้วเชื่อมตอนช่อง LIVE ลอง Action จำลองก่อน และตรวจภาพเสียงจากฝั่งผู้ชม",
                  page: "actions",
                },
              ].map((step, i) => (
                <button
                  className="guide-step"
                  key={step.title}
                  onClick={() => setPage(step.page as Page)}
                >
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                  </div>
                  <ArrowUpRight size={20} />
                </button>
              ))}
              <div className="info-note">
                <CircleHelp size={18} />
                เชื่อมเสียงจากหน้าเสียงพูดใน Dobby ก่อนใช้ speak_text
                ส่วนการเปิดไลฟ์ยังเริ่มจาก LIVE Studio
              </div>
            </section>
          )}
          <footer>
            <span>
              <span className="status-dot" />
              Everything starts with a little spark.
            </span>
            <span>
              Built for your next LIVE <Sparkles size={12} />
            </span>
          </footer>
        </main>
        {state.debug.enabled && page !== "debug" && (
          <DebugHud onOpen={() => setPage("debug")} />
        )}
        <div className="audio-dock">
          <div>
            <AudioLines size={18} />
            <b>เสียงสำหรับขยับปาก</b>
            <span>
              {state.voice.status === "connected"
                ? `${state.voice.preview ? "ฟังตัวอย่าง" : "Codex"} · ${state.voice.sessionVoice ?? state.voice.settings.voice}${state.voice.speaking ? " · กำลังพูด" : " · พร้อมพูด"}`
                : audio.active
                  ? "กำลังรับเสียงจากอุปกรณ์ที่เลือก"
                  : "ยังไม่ได้เลือกแหล่งเสียง"}
            </span>
          </div>
          <AudioBars />
          <button
            className="text-button"
            onClick={audio.active ? audio.stop : () => setPage("voice")}
          >
            {audio.active ? "หยุดรับเสียง" : "ตั้งค่าเสียงพูด"}
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function FlaskIcon() {
  return <SlidersHorizontal size={13} />;
}
function ConnectionRow({
  name,
  detail,
  on,
}: {
  name: string;
  detail: string;
  on: boolean;
}) {
  return (
    <div className="connection-row">
      <span className={`service-symbol ${on ? "connected" : ""}`}>
        {name === "Codex" ? (
          <Blocks size={17} />
        ) : name === "Euler Stream" ? (
          <Waves size={17} />
        ) : (
          <Radio size={17} />
        )}
      </span>
      <div>
        <b>{name}</b>
        <small>{detail}</small>
      </div>
      <span className={`status-dot ${on ? "" : "muted"}`} />
    </div>
  );
}

function CharacterPage({
  state,
  command,
  notify,
}: {
  state: AppState;
  command: (c: Command) => Promise<boolean>;
  notify: (t: string) => void;
}) {
  const [draft, setDraft] = useState(state.character);
  const replyLanguages = [
    ["th", "ไทย"],
    ["en", "อังกฤษ"],
    ["ja", "ญี่ปุ่น"],
    ["ko", "เกาหลี"],
    ["zh", "จีน"],
  ];
  return (
    <div className="character-layout">
      <section className="panel settings-panel">
        <div className="section-intro">
          <span className="section-icon">
            <UserRound />
          </span>
          <div>
            <h2>บุคลิกที่ทำให้จำได้</h2>
            <p>โปรไฟล์นี้ให้ Codex โหลดผ่านเครื่องมือ get_character</p>
          </div>
        </div>
        <label className="field">
          ชื่อตัวละคร
          <input
            maxLength={40}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label className="field">
          บุคลิก
          <textarea
            maxLength={1500}
            rows={3}
            value={draft.personality}
            onChange={(e) =>
              setDraft({ ...draft, personality: e.target.value })
            }
          />
        </label>
        <label className="field">
          ภาษาที่ใช้ตอบผู้ชม
          <select
            value={draft.language}
            onChange={(e) => setDraft({ ...draft, language: e.target.value })}
          >
            {replyLanguages.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
            {draft.language &&
              !replyLanguages.some(([code]) => code === draft.language) && (
                <option value={draft.language}>{draft.language}</option>
              )}
          </select>
        </label>
        <label className="field">
          วิธีพูดและคำติดปาก
          <textarea
            maxLength={1500}
            rows={3}
            value={draft.speakingStyle}
            onChange={(e) =>
              setDraft({ ...draft, speakingStyle: e.target.value })
            }
          />
        </label>
        <div className="form-footer">
          <span>เริ่ม Auto Host ใหม่เพื่อใช้ค่าที่บันทึก</span>
          <button
            className="button primary"
            disabled={!draft.name.trim()}
            onClick={async () => {
              if (await command({ type: "character", character: draft }))
                notify("บันทึกคาแรกเตอร์แล้ว");
            }}
          >
            <Check size={16} />
            บันทึกคาแรกเตอร์
          </button>
        </div>
      </section>
      <section className="panel character-preview">
        <div className="eyebrow">MEET YOUR COMPANION</div>
        <SceneFrame state={state} />
        <h2>{draft.name || "Dobby"}</h2>
        <p>
          คาแรกเตอร์เปลี่ยนได้
          <br />
          ทุกไลฟ์ยังเป็นตัวคุณ
        </p>
        <span className="soft-badge">ตัวละครตัวอย่าง</span>
      </section>
    </div>
  );
}

function Connections({
  state,
  command,
  notify,
  audio,
  copyOutput,
}: {
  state: AppState;
  command: (c: Command) => Promise<boolean>;
  notify: (t: string) => void;
  audio: ReturnType<typeof useAudio>;
  copyOutput: () => Promise<void>;
}) {
  const [username, setUsername] = useState(state.euler.username),
    [key, setKey] = useState(""),
    [remember, setRemember] = useState(false),
    [mcp, setMcp] = useState("");
  useEffect(() => {
    void window.dobby.mcpConfig().then(setMcp);
  }, []);
  const busy = ["connected", "connecting", "reconnecting"].includes(
    state.euler.status,
  );
  return (
    <div className="connections-grid">
      <section className="panel settings-panel">
        <div className="section-intro">
          <span className="section-icon">
            <Waves />
          </span>
          <div>
            <h2>Euler Stream</h2>
            <p>รับปฏิสัมพันธ์จากช่อง TikTok ของคุณ</p>
          </div>
          <span
            className={`status-dot ${state.euler.status === "connected" ? "" : "muted"}`}
          />
        </div>
        <label className="field">
          ชื่อช่อง TikTok
          <input
            placeholder="@your_channel"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="field">
          Euler API key
          <input
            type="password"
            placeholder={
              state.euler.hasKey
                ? "มี key แล้ว · กรอกเพื่อเปลี่ยน"
                : "กรอก API key ของคุณ"
            }
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          จำ key แบบเข้ารหัสบนเครื่องนี้
        </label>
        <div className="status-message">{state.euler.message}</div>
        <div className="button-row">
          <button
            className="button secondary"
            disabled={!username.trim() || (!key.trim() && !state.euler.hasKey)}
            onClick={async () => {
              if (
                await command({
                  type: "saveEuler",
                  username,
                  apiKey: key,
                  remember,
                })
              )
                setKey("");
            }}
          >
            บันทึก
          </button>
          <button
            className="button primary"
            disabled={!state.euler.hasKey}
            onClick={() =>
              command({ type: busy ? "disconnectEuler" : "connectEuler" })
            }
          >
            {busy ? <Unplug size={15} /> : <Link2 size={15} />}{" "}
            {busy ? "ตัดการเชื่อมต่อ" : "เชื่อมช่อง LIVE"}
          </button>
          {state.euler.hasKey && (
            <button
              className="text-button"
              onClick={() => command({ type: "forgetEuler" })}
            >
              ลืม key
            </button>
          )}
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="section-intro">
          <span className="section-icon">
            <Blocks />
          </span>
          <div>
            <h2>Codex</h2>
            <p>เชื่อมผ่าน MCP เพื่อควบคุม Dobby</p>
          </div>
        </div>
        <p className="body-copy">
          เพิ่มการตั้งค่านี้ใน Codex แล้วเปิดแชตใหม่ เรียก get_status เพื่อทดสอบ จากนั้นโหลด
          get_character เพื่อใช้บุคลิก
        </p>
        <pre className="config-preview">{mcp}</pre>
        <div className="button-row">
          <button
            className="button secondary"
            onClick={async () => {
              await window.dobby.copy(mcp);
              notify("คัดลอกการตั้งค่า MCP แล้ว");
            }}
          >
            <Copy size={15} />
            คัดลอกการตั้งค่า MCP
          </button>
        </div>
        <div className="info-note">
          {state.codex.lastSeen
            ? "มีการเรียกเครื่องมือผ่าน MCP แล้ว"
            : "ยังไม่มีการเรียกเครื่องมือ · เชื่อมเสียงพูดได้จากเมนูเสียงพูด"}
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="section-intro">
          <span className="section-icon">
            <Sparkles />
          </span>
          <div>
            <h2>Live2D ภายใน Dobby</h2>
            <p>เลือกและสลับโมเดลจากหน้าคลังโมเดล</p>
          </div>
        </div>
        <p className="body-copy">
          นำเข้าชุดไฟล์ .model3.json เพื่อแสดงโมเดลจริงใน Dobby และ output เดียวกัน
          ปรับขนาด ตำแหน่ง สีหน้า และท่าทางแยกต่อโมเดลได้
        </p>
        <div className="status-message">
          {state.avatar.selectedId
            ? `เลือก ${state.avatar.models.find((m) => m.id === state.avatar.selectedId)?.name ?? "Live2D"} แล้ว`
            : "ยังใช้ตัวละครตัวอย่าง"}{" "}
          · {state.avatar.models.length} โมเดลในคลัง
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="section-intro">
          <span className="section-icon">
            <Volume2 />
          </span>
          <div>
            <h2>เสียงและ LIVE Studio</h2>
            <p>ภาพ เสียง และปาก ต้องใช้แหล่งเดียวกัน</p>
          </div>
        </div>
        <p className="body-copy">
          เลือกอุปกรณ์เสียงที่รับเสียงตัวละคร เช่น virtual audio input หากเลือกไมโครโฟน
          ปากจะขยับตามเสียงไมค์
        </p>
        <label className="field">
          แหล่งเสียงสำหรับขยับปาก
          <select
            disabled={audio.active}
            value={audio.device}
            onChange={(e) => audio.setDevice(e.target.value)}
          >
            <option value="">อุปกรณ์เสียงเริ่มต้น</option>
            {audio.devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Audio input"}
              </option>
            ))}
          </select>
        </label>
        <div className="button-row">
          <button
            className="button secondary"
            onClick={audio.active ? audio.stop : audio.start}
          >
            {audio.active ? <Pause size={15} /> : <Mic size={15} />}{" "}
            {audio.active ? "หยุดรับเสียง" : "เริ่มรับเสียง"}
          </button>
          <button
            className="button secondary"
            onClick={() => window.dobby.openOutput()}
          >
            <ExternalLink size={15} />
            ดู output
          </button>
        </div>
        <div className="output-link-box">
          <span>เพิ่มเป็น Link source ใน TikTok LIVE Studio</span>
          <button className="icon-button" title="คัดลอกลิงก์" onClick={copyOutput}>
            <Copy size={15} />
          </button>
        </div>
        <div className="info-note">
          เลือกเสียง Codex จากหน้าเสียงพูดได้โดยตรง · เพิ่มเสียงแอป Dobby แยกใน LIVE
          Studio
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  location.pathname === "/output" ? <Output /> : <App />,
);
