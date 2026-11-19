import { contextBridge, ipcRenderer } from "electron";
import type { DobbyAPI } from "../src/shared";
const api: DobbyAPI = {
  brainPrepare: () => ipcRenderer.invoke("dobby:brain-prepare"),
  brainSelect: (id) => ipcRenderer.invoke("dobby:brain-select", id),
  voicePrepare: () => ipcRenderer.invoke("dobby:voice-prepare"),
  voiceSettings: (settings) =>
    ipcRenderer.invoke("dobby:voice-settings", settings),
  voiceConnect: (sdp, previewSettings, mode) =>
    ipcRenderer.invoke("dobby:voice-connect", sdp, previewSettings, mode),
  autoHost: (enabled) => ipcRenderer.invoke("dobby:auto-host", enabled),
  voiceSpeak: (text, preview) =>
    ipcRenderer.invoke("dobby:voice-speak", text, preview),
  voiceDisconnect: () => ipcRenderer.invoke("dobby:voice-disconnect"),
  voicePlayback: (event) => ipcRenderer.send("dobby:voice-playback", event),
  state: () => ipcRenderer.invoke("dobby:state"),
  command: (command) => ipcRenderer.invoke("dobby:command", command),
  subscribe: (callback) => {
    const listener = (_event: unknown, state: Parameters<typeof callback>[0]) =>
      callback(state);
    ipcRenderer.on("dobby:state-changed", listener);
    return () => ipcRenderer.removeListener("dobby:state-changed", listener);
  },
  audio: (level, active) => ipcRenderer.send("dobby:audio", { level, active }),
  copy: (text) => ipcRenderer.invoke("dobby:copy", text),
  openOutput: () => ipcRenderer.invoke("dobby:output"),
  mcpConfig: () => ipcRenderer.invoke("dobby:mcp-config"),
  importModels: () => ipcRenderer.invoke("dobby:import-models"),
  importCore: () => ipcRenderer.invoke("dobby:import-core"),
  avatarReady: (id, error) =>
    ipcRenderer.send("dobby:avatar-ready", { id, error }),
  importBackground: (kind) =>
    ipcRenderer.invoke("dobby:import-background", kind),
  debugMetrics: () => ipcRenderer.invoke("dobby:debug-metrics"),
  onVoiceReplyDone: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("dobby:voice-reply-done", listener);
    return () => ipcRenderer.removeListener("dobby:voice-reply-done", listener);
  },
};
contextBridge.exposeInMainWorld("dobby", api);
