/** Local development harness for testing the real renderer and Codex voice without changing the user's running Dobby session. */
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { randomBytes } from "node:crypto";
import { DobbyCore } from "../electron/core";
import { DobbyVoice } from "../electron/voice";
import { DobbyBrain } from "../electron/brain";
import { AutoHost } from "../electron/auto-host";
const folder = "/tmp/dobby-voice-browser-04";
await mkdir(folder, { recursive: true });
const core = new DobbyCore(),
  voice = new DobbyVoice(folder);
await voice.load();
core.state.voice = voice.state;
const autoHostTest = process.argv.includes("--auto-host");
const brain = new DobbyBrain(folder);
await brain.load();
core.state.brain = brain.state;
brain.on("change", () => {
  core.state.brain = brain.state;
});
const host = new AutoHost(core, voice, brain);
if (autoHostTest) {
  core.state.euler.status = "connected";
  voice.state.settings.volume = 0;
}
voice.on("protocolEvent", (method) => {
  if (method.startsWith("thread/realtime/")) console.log(method);
});
voice.on("change", () => {
  core.state.voice = voice.state;
  if (voice.state.status !== "connected")
    core.state.audio = { level: 0, active: false };
});
const token = randomBytes(24).toString("hex");
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://127.0.0.1");
  const json = (status: number, data: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  if (
    req.headers.origin &&
    req.headers.origin !== `http://${req.headers.host}`
  ) {
    json(403, {});
    return;
  }
  try {
    if (url.pathname.startsWith("/qa/")) {
      if (
        req.headers.authorization !== `Bearer ${token}` ||
        req.method !== "POST"
      ) {
        json(401, {});
        return;
      }
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 200_000) throw new Error("Too large");
      }
      const data = body ? JSON.parse(body) : {};
      let result: unknown;
      switch (url.pathname) {
        case "/qa/state":
          result = core.state;
          break;
        case "/qa/brain-prepare":
          await brain.prepare();
          break;
        case "/qa/brain-select":
          await brain.select(data.id);
          break;
        case "/qa/prepare":
          await voice.prepare();
          break;
        case "/qa/settings":
          await voice.settings(data);
          break;
        case "/qa/connect":
          result = await voice.connect(
            data.sdp,
            core.state.character,
            data.previewSettings,
            data.mode,
            brain.state.selectedId !== null,
          );
          break;
        case "/qa/host":
          if (data.enabled) host.start();
          else {
            host.stop();
            voice.disconnect();
          }
          break;
        case "/qa/command":
          if (autoHostTest && data.type === "simulate")
            core.simulate(data.eventType);
          if (data.type === "character") core.state.character = data.character;
          result = core.state;
          break;
        case "/qa/speak":
          result = await voice.speak(data, data.preview === true);
          break;
        case "/qa/disconnect":
          voice.disconnect();
          break;
        case "/qa/audio":
          core.state.audio = data;
          break;
        case "/qa/playback":
          if (data.type === "connected") voice.connected();
          else if (data.type === "finished") voice.finished();
          else voice.fail(data.message);
          break;
        default:
          throw new Error("Unknown QA request");
      }
      json(200, { result: result ?? null });
      return;
    }
    if (url.pathname === "/" && url.searchParams.get("key") === token) {
      const bootstrap = `<script>const auth=${JSON.stringify(token)};async function qa(name,data){const r=await fetch('/qa/'+name,{method:'POST',headers:{'Authorization':'Bearer '+auth,'Content-Type':'application/json'},body:JSON.stringify(data??{})});const v=await r.json();if(!r.ok)throw new Error(v.error);return v.result;}window.dobby={state:()=>qa('state'),subscribe:cb=>{const t=setInterval(()=>qa('state').then(cb),100);return()=>clearInterval(t)},brainPrepare:()=>qa('brain-prepare'),brainSelect:id=>qa('brain-select',{id}),voicePrepare:()=>qa('prepare'),voiceSettings:s=>qa('settings',s),voiceConnect:(sdp,previewSettings,mode)=>qa('connect',{sdp,previewSettings,mode}),autoHost:enabled=>qa('host',{enabled}),voiceSpeak:(text,preview)=>qa('speak',{text,preview}),voiceDisconnect:()=>qa('disconnect'),voicePlayback:e=>void qa('playback',e),audio:(level,active)=>void qa('audio',{level,active}),copy:()=>Promise.resolve(),command:data=>qa('command',data),avatarReady:()=>{},mcpConfig:()=>Promise.resolve('Local QA only')};</script>`;
      const html = await readFile(resolve("dist/index.html"), "utf8");
      res.setHeader("Content-Type", "text/html");
      res.end(html.replace("<head>", "<head>" + bootstrap));
      return;
    }
    if (!url.pathname.startsWith("/assets/")) {
      json(404, {});
      return;
    }
    const file = resolve("dist", "." + url.pathname);
    if (!file.startsWith(resolve("dist/assets") + "/"))
      throw new Error("Forbidden");
    res.setHeader(
      "Content-Type",
      (
        {
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".png": "image/png",
        } as Record<string, string>
      )[extname(file)] ?? "application/octet-stream",
    );
    res.end(await readFile(file));
  } catch (e) {
    json(400, { error: e instanceof Error ? e.message : "QA error" });
  }
});
server.listen(0, "127.0.0.1", () => {
  const a = server.address();
  if (a && typeof a !== "string")
    console.log(`http://127.0.0.1:${a.port}/?key=${token}`);
});
const stop = () => {
  host.dispose();
  brain.dispose();
  voice.disconnect();
  server.close();
  process.exit();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
