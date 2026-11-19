import { useEffect, useRef, useState } from "react";
import type { VoiceState, VoiceSettings } from "./shared";
import { createAudioReporter } from "./audio-level";
type Resources = {
  peer: RTCPeerConnection;
  context: AudioContext;
  gain: GainNode;
  analyser: AnalyserNode;
  frame: number;
  silentInput: MediaStream;
  silence: ConstantSourceNode;
  source?: MediaStreamAudioSourceNode;
  media: HTMLAudioElement;
  remoteTrack?: MediaStreamTrack;
};
type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };
export function useCodexVoice(
  voice: VoiceState | undefined,
  notify: (message: string) => void,
) {
  const resources = useRef<Resources | null>(null);
  const report = useRef(createAudioReporter()).current;
  const connecting = useRef(false);
  const busy = useRef({
    requested: false,
    at: 0,
    heard: false,
    lastSound: 0,
    serverDone: false,
  });
  /** Utterance the end-of-speech detector is armed for. */
  const armedFor = useRef(-1);
  /** True once this session has delivered a reply-done signal, so it can be trusted. */
  const sawReplyDone = useRef(false);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]),
    [sink, setSink] = useState("");
  const [signal, setSignal] = useState({
    bytes: 0,
    energy: 0,
    peak: 0,
    context: "closed",
    muted: true,
  });
  const cleanup = () => {
    const r = resources.current;
    resources.current = null;
    if (r) {
      clearInterval(r.frame);
      r.peer.close();
      r.silentInput.getTracks().forEach((track) => track.stop());
      r.silence.stop();
      r.source?.disconnect();
      r.media.pause();
      r.media.srcObject = null;
      void r.context.close();
      report(0, false);
    }
    busy.current.requested = false;
  };
  useEffect(() => {
    const refresh = () =>
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) =>
          setOutputs(devices.filter((d) => d.kind === "audiooutput")),
        )
        .catch(() => {});
    void refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () =>
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, []);
  useEffect(() => {
    if (
      (voice?.status === "disconnected" && !connecting.current) ||
      voice?.status === "error"
    )
      cleanup();
    if (voice?.status === "connected") connecting.current = false;
    if (resources.current && voice)
      resources.current.media.volume = voice.settings.volume;
  }, [voice?.status, voice?.settings.volume]);
  // Arm per utterance id, not on the speaking edge: state updates are batched, so
  // "finished → next reply" can arrive as one update with speaking still true.
  useEffect(() => {
    if (voice?.speaking && voice.utterance !== armedFor.current) {
      armedFor.current = voice.utterance;
      busy.current = {
        requested: true,
        at: performance.now(),
        heard: false,
        lastSound: 0,
        serverDone: false,
      };
    } else if (!voice?.speaking) busy.current.requested = false;
  }, [voice?.speaking, voice?.utterance]);
  useEffect(
    () =>
      window.dobby.onVoiceReplyDone(() => {
        sawReplyDone.current = true;
        busy.current.serverDone = true;
      }),
    [],
  );
  useEffect(() => () => cleanup(), []);
  const connect = async (
    settings: VoiceSettings,
    preview = false,
    mode: "speech" | "host" = "speech",
  ) => {
    cleanup();
    sawReplyDone.current = false;
    connecting.current = true;
    const context = new AudioContext();
    void context.resume(); // Resume inside the user's click, before IPC/network work.
    const peer = new RTCPeerConnection(),
      gain = context.createGain(),
      analyser = context.createAnalyser();
    gain.gain.value = 0; // Only the media element plays sound; this graph measures it.
    analyser.fftSize = 1024;
    analyser.connect(gain);
    gain.connect(context.destination);
    // Codex Voice is full duplex: a generated silent track advances its audio clock.
    // This does not request or transmit microphone audio.
    const input = context.createMediaStreamDestination(),
      silence = context.createConstantSource();
    silence.offset.value = 0;
    silence.connect(input);
    silence.start();
    const media = new Audio();
    media.autoplay = true;
    media.volume = settings.volume;
    const r: Resources = {
      peer,
      context,
      gain,
      analyser,
      frame: 0,
      silentInput: input.stream,
      silence,
      media,
    };
    resources.current = r;
    let failed = false;
    const failure = (message: string) => {
      if (resources.current !== r || failed) return;
      failed = true;
      connecting.current = false;
      cleanup();
      window.dobby.voicePlayback({ type: "error", message });
      notify(message);
    };
    try {
      if (!preview) await window.dobby.voiceSettings(settings);
      // Settings may publish a disconnected state while being saved. Restore this new session's resources.
      if (context.state === "closed")
        throw new Error("กรุณากดเชื่อมเสียงอีกครั้งหลังบันทึกการตั้งค่า");
      if (sink) await media.setSinkId(sink);
      peer.addTrack(input.stream.getAudioTracks()[0], input.stream);
      const events = peer.createDataChannel("oai-events");
      events.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "error")
            failure(
              String(data.error?.message ?? "Codex ไม่สามารถเล่นเสียงได้").slice(
                0,
                300,
              ),
            );
        } catch {
          /* Ignore non-JSON protocol messages. */
        }
      };
      peer.ontrack = (event) => {
        if (resources.current !== r) return;
        r.source?.disconnect();
        r.remoteTrack = event.track;
        media.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        r.source = context.createMediaStreamSource(
          media.srcObject as MediaStream,
        );
        r.source.connect(analyser);
        void media.play().catch(() => notify("กดพูดข้อความนี้เพื่อเริ่มเล่นเสียง"));
      };
      const connected = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("เชื่อมสัญญาณเสียงไม่สำเร็จ ลองตรวจเครือข่ายหรือ VPN")),
          25_000,
        );
        peer.onconnectionstatechange = () => {
          if (resources.current !== r) {
            clearTimeout(timer);
            reject(new Error("ยกเลิกการเชื่อมต่อแล้ว"));
            return;
          }
          if (peer.connectionState === "connected") {
            clearTimeout(timer);
            window.dobby.voicePlayback({ type: "connected" });
            resolve();
          }
          if (peer.connectionState === "failed") {
            clearTimeout(timer);
            const error = new Error("การเชื่อมต่อเสียงขัดข้อง · กดเชื่อมใหม่");
            reject(error);
            failure(error.message);
          }
        };
      });
      connected.catch(() => {});
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const remoteSdp = await window.dobby.voiceConnect(
        peer.localDescription!.sdp,
        preview ? settings : undefined,
        mode,
      );
      if (resources.current !== r) throw new Error("ยกเลิกการเชื่อมต่อแล้ว");
      await peer.setRemoteDescription({ type: "answer", sdp: remoteSdp });
      await connected;
      const values = new Float32Array(analyser.fftSize);
      let lastStats = 0,
        lastSignal = 0;
      let peak = 0;
      let previousEnergy = 0,
        previousDuration = 0,
        statsRms = 0;
      const sample = () => {
        if (resources.current !== r) return;
        analyser.getFloatTimeDomainData(values);
        let sum = 0;
        for (let i = 0; i < values.length; i++) sum += values[i] * values[i];
        const waveformRms = Math.sqrt(sum / values.length);
        const now = performance.now();
        const packetRms = Math.max(
          0,
          ...peer
            .getReceivers()
            .flatMap((receiver) => receiver.getSynchronizationSources())
            .filter((source) => now - source.timestamp < 250)
            .map((source) => source.audioLevel ?? 0),
        );
        const rms = Math.max(
          waveformRms,
          packetRms,
          now - lastStats < 400 ? statsRms : 0,
        );
        peak = Math.max(peak, rms);
        if (now - lastStats > 200) {
          lastStats = now;
          void peer.getStats().then((stats) => {
            let bytes = 0,
              energy = 0,
              duration = 0;
            stats.forEach((report) => {
              if (report.type === "inbound-rtp" && report.kind === "audio") {
                bytes += report.bytesReceived ?? 0;
                energy += report.totalAudioEnergy ?? 0;
                duration += report.totalSamplesDuration ?? 0;
              }
            });
            statsRms =
              duration > previousDuration
                ? Math.sqrt(
                    Math.max(0, energy - previousEnergy) /
                      (duration - previousDuration),
                  )
                : 0;
            previousEnergy = energy;
            previousDuration = duration;
            // Diagnostics only: re-rendering the voice page 1×/s is enough.
            if (resources.current === r && now - lastSignal >= 1000) {
              lastSignal = now;
              setSignal({
                bytes,
                energy,
                peak,
                context: context.state,
                muted: r.remoteTrack?.muted ?? true,
              });
            }
          });
        }
        report(Math.min(1, rms * 7), true);
        const b = busy.current;
        if (b.requested) {
          if (rms > 0.0015) {
            b.heard = true;
            b.lastSound = now;
          }
          // Codex said the reply is complete → a short tail of silence is enough.
          // Without that signal, fall back to a longer guess (shorter if this
          // session never sends the signal, as before).
          const quietNeeded = b.serverDone ? 450 : sawReplyDone.current ? 3000 : 1600;
          if (b.heard && now - b.lastSound > quietNeeded) {
            b.requested = false;
            window.dobby.voicePlayback({ type: "finished" });
          } else if (!b.heard && now - b.at > 25_000)
            failure("Codex ยังไม่ส่งเสียงกลับมา · ตรวจสิทธิ์ Voice แล้วเชื่อมใหม่");
        }
      };
      // A timer keeps sampling when the window is covered (e.g. by LIVE Studio);
      // animation frames stop in an occluded window and would freeze lip-sync
      // and end-of-speech detection.
      sample();
      r.frame = window.setInterval(sample, 30);
      return true;
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              "",
            )
          : "เชื่อมเสียงไม่ได้";
      failure(message);
      return false;
    }
  };
  const disconnect = async () => {
    connecting.current = false;
    cleanup();
    await window.dobby.voiceDisconnect();
  };
  const selectOutput = async (deviceId: string) => {
    try {
      if (resources.current) await resources.current.media.setSinkId(deviceId);
      setSink(deviceId);
    } catch {
      notify("เลือกอุปกรณ์เสียงนี้ไม่ได้ · ลองอุปกรณ์เริ่มต้น");
    }
  };
  return {
    connect,
    disconnect,
    outputs,
    sink,
    selectOutput,
    signal,
    resume: async () => {
      const r = resources.current;
      if (r) {
        await r.context.resume();
        await r.media.play();
      }
    },
  };
}
