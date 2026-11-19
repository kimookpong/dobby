import {
  app,
  BrowserWindow,
  ipcMain,
  clipboard,
  safeStorage,
  session,
  dialog,
} from "electron";
import { readFile, writeFile, mkdir, unlink, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { DobbyCore, type SavedSettings } from "./core";
import {
  commandSchema,
  characterSchema,
  hostSettingsSchema,
  overlaySchema,
  welcomeSchema,
  giftTierSchema,
  regularSchema,
} from "./validation";
import { ViewerRegistry } from "./viewers";
import { EulerConnector } from "./euler";
import { ModelLibrary } from "./models";
import { SceneStore } from "./scene";
import { startLocalServer } from "./server";
import { DobbyVoice, voiceSettingsSchema, speakSchema } from "./voice";
import { AutoHost } from "./auto-host";
import { DobbyBrain } from "./brain";
import { ConversationMemory } from "./memory";
import { throttle } from "./throttle";
import { DebugMonitor } from "./debug";

app.setName("Dobby");
if (!app.requestSingleInstanceLock()) app.quit();
else void boot();
async function boot() {
  await app.whenReady();
  const folder = app.getPath("userData");
  await mkdir(folder, { recursive: true });
  const settingsFile = join(folder, "settings.json"),
    vaultFile = join(folder, "euler-key.enc"),
    connectionFile = join(folder, "mcp-connection.json");
  let saved: SavedSettings = {};
  try {
    const raw = JSON.parse(await readFile(settingsFile, "utf8"));
    saved.character = characterSchema.parse(raw.character);
    const parsed = commandSchema.safeParse({ type: "rules", rules: raw.rules });
    if (parsed.success && parsed.data.type === "rules")
      saved.rules = parsed.data.rules;
    saved.username = typeof raw.username === "string" ? raw.username : "";
    const hostSettings = hostSettingsSchema.safeParse(raw.hostSettings);
    if (hostSettings.success) saved.hostSettings = hostSettings.data;
    const overlay = overlaySchema.safeParse(raw.overlay);
    if (overlay.success) saved.overlay = overlay.data;
    const welcome = welcomeSchema.safeParse(raw.welcome);
    if (welcome.success) saved.welcome = welcome.data;
    const giftTiers = giftTierSchema.safeParse(raw.giftTiers);
    if (giftTiers.success) saved.giftTiers = giftTiers.data;
    const regulars = regularSchema.safeParse(raw.regulars);
    if (regulars.success) saved.regulars = regulars.data;
  } catch {
    /* A first launch has no saved settings. */
  }
  const core = new DobbyCore(saved),
    euler = new EulerConnector(core),
    models = new ModelLibrary(folder);
  await models.load();
  const scenes = new SceneStore(folder);
  await scenes.load();
  const resetAudio = () => {
    core.state.audio = { level: 0, active: false };
    core.emit("audio", core.state.audio);
  };
  const voice = new DobbyVoice(folder);
  await voice.load();
  const brain = new DobbyBrain(folder);
  await brain.load();
  core.state.brain = brain.state;
  brain.on("change", () => {
    core.state.brain = brain.state;
    core.publish();
  });
  const memory = new ConversationMemory(folder);
  await memory.load();
  const viewers = new ViewerRegistry(folder);
  await viewers.load();
  const refreshViewerCounts = () => {
    core.state.regulars.known = viewers.size;
    core.state.regulars.regulars = viewers.regularCount(core.state.regulars);
  };
  refreshViewerCounts();
  // Fires at most once per background save (every few seconds), not per event.
  viewers.on("change", () => {
    refreshViewerCounts();
    core.publish();
  });
  const host = new AutoHost(core, voice, brain, memory, Date.now, viewers);
  const processLabel = (pid: number, type: string) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.getOSProcessId() !== pid)
        continue;
      return window === main ? "หน้าต่างหลัก" : "หน้าต่าง output";
    }
    return type === "Browser"
      ? "Main process"
      : type === "Tab"
        ? "หน้าเว็บอื่น"
        : type;
  };
  const debug = new DebugMonitor(core, () =>
    app.getAppMetrics().map((m) => ({
      label: processLabel(m.pid, m.type),
      pid: m.pid,
      cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10,
      memoryMB: Math.round(m.memory.workingSetSize / 1024),
    })),
  );
  const assertTestEventsAllowed = () => {
    if (
      core.state.euler.status === "connected" &&
      !(core.state.debug.enabled && core.state.debug.injectOnLive)
    )
      throw new Error(
        "ตัดการเชื่อมต่อ Euler ก่อนใช้เหตุการณ์จำลอง หรือเปิด \"ทดสอบระหว่างไลฟ์จริง\" ในหน้า Debug",
      );
  };
  core.state.voice = voice.state;
  voice.on("change", () => {
    core.state.voice = voice.state;
    if (voice.state.status !== "connected")
      resetAudio();
    core.publish();
  });
  let apiKey = "";
  try {
    const encrypted = await readFile(vaultFile);
    apiKey = (await safeStorage.decryptStringAsync(encrypted)).result;
  } catch {
    /* User can re-enter a key if storage is unavailable. */
  }
  core.state.euler.hasKey = !!apiKey;
  const local = await startLocalServer(
    core,
    join(__dirname, "../dist"),
    models,
    scenes,
    voice,
    memory,
  );
  const refreshScene = () => {
    core.state.scene = scenes.state(local.origin, local.outputToken);
    core.publish();
  };
  refreshScene();
  const refreshAvatar = () => {
    const next = models.state(local.origin, local.outputToken),
      previous = core.state.avatar;
    if (
      next.selectedId === previous.selectedId &&
      next.coreUrl === previous.coreUrl
    ) {
      next.status = previous.status;
      next.error = previous.error;
    }
    core.state.avatar = next;
    core.publish();
  };
  refreshAvatar();
  await writeFile(
    connectionFile,
    JSON.stringify({
      origin: local.origin,
      token: local.operatorToken,
      executable: process.execPath,
      server: join(__dirname, "mcp.mjs"),
    }),
    { mode: 0o600 },
  );
  let main: BrowserWindow;
  let outputWindow: BrowserWindow | null = null;
  const createWindow = () => {
    main = new BrowserWindow({
      title: "Dobby",
      width: 1440,
      height: 940,
      minWidth: 1100,
      minHeight: 750,
      backgroundColor: "#0b0e13",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 22, y: 22 },
      webPreferences: {
        backgroundThrottling: false,
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    main.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    main.webContents.on("will-navigate", (e) => e.preventDefault());
    if (process.env.DOBBY_DEV_URL) void main.loadURL("http://127.0.0.1:5173");
    else void main.loadFile(join(__dirname, "../dist/index.html"));
    main.webContents.on("render-process-gone", () => {
      voice.disconnect();
      resetAudio();
      core.publish();
    });
    main.on("closed", () => {
      voice.disconnect();
      resetAudio();
      core.publish();
    });
  };
  createWindow();
  app.on("second-instance", () => {
    if (!main || main.isDestroyed()) createWindow();
    else {
      main.show();
      main.focus();
    }
  });
  app.on("activate", () => {
    if (!main || main.isDestroyed()) createWindow();
    else main.show();
  });
  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback) =>
      callback(contents.id === main.webContents.id && permission === "media"),
  );
  const check = (senderId: number) => {
    if (!main || main.isDestroyed() || senderId !== main.webContents.id)
      throw new Error("Untrusted window");
  };
  let writing = Promise.resolve();
  const persist = () => {
    const data = JSON.stringify(core.settings(), null, 2);
    writing = writing
      .catch(() => {})
      .then(async () => {
        await writeFile(settingsFile + ".tmp", data, { mode: 0o600 });
        await rename(settingsFile + ".tmp", settingsFile);
      });
    return writing;
  };
  ipcMain.handle("dobby:voice-prepare", async (event) => {
    check(event.sender.id);
    await voice.prepare();
  });
  ipcMain.handle("dobby:voice-settings", async (event, raw) => {
    check(event.sender.id);
    await voice.settings(voiceSettingsSchema.parse(raw));
  });
  ipcMain.handle(
    "dobby:voice-connect",
    async (event, raw, previewSettings, rawMode) => {
      check(event.sender.id);
      return voice.connect(
        z.string().min(1).max(100_000).parse(raw),
        core.state.character,
        previewSettings === undefined
          ? undefined
          : voiceSettingsSchema.parse(previewSettings),
        rawMode === undefined
          ? "speech"
          : z.enum(["speech", "host"]).parse(rawMode),
        brain.state.selectedId !== null,
      );
    },
  );
  ipcMain.handle("dobby:brain-prepare", async (event) => {
    check(event.sender.id);
    if (core.state.autoHost.enabled)
      throw new Error("หยุด Auto Host ก่อนโหลดโมเดลใหม่");
    await brain.prepare();
  });
  ipcMain.handle("dobby:brain-select", async (event, raw) => {
    check(event.sender.id);
    if (core.state.autoHost.enabled)
      throw new Error("หยุด Auto Host ก่อนเปลี่ยนโมเดล AI");
    await brain.select(z.string().nullable().parse(raw));
  });
  ipcMain.handle("dobby:auto-host", (event, raw) => {
    check(event.sender.id);
    if (z.boolean().parse(raw)) host.start();
    else {
      host.stop();
      voice.disconnect();
    }
  });
  ipcMain.handle("dobby:voice-speak", async (event, text, preview) => {
    check(event.sender.id);
    if (core.state.autoHost.enabled)
      throw new Error("หยุด Auto Host ก่อนสั่งพูดข้อความเอง");
    return voice.speak(
      speakSchema.parse({ text }),
      preview === undefined ? false : z.boolean().parse(preview),
    );
  });
  ipcMain.handle("dobby:voice-disconnect", (event) => {
    check(event.sender.id);
    voice.disconnect();
  });
  ipcMain.on("dobby:voice-playback", (event, raw) => {
    check(event.sender.id);
    const data = z
      .object({
        type: z.enum(["connected", "finished", "error"]),
        message: z.string().max(300).optional(),
      })
      .safeParse(raw);
    if (!data.success) return;
    if (data.data.type === "connected") voice.connected();
    if (data.data.type === "finished") voice.finished();
    if (data.data.type === "error")
      voice.fail(data.data.message ?? "เล่นเสียงไม่ได้ · เชื่อมใหม่");
  });
  ipcMain.handle("dobby:debug-metrics", (event) => {
    check(event.sender.id);
    return debug.snapshot();
  });
  ipcMain.handle("dobby:state", (event) => {
    check(event.sender.id);
    return core.state;
  });
  ipcMain.handle("dobby:import-models", async (event) => {
    check(event.sender.id);
    const result = await dialog.showOpenDialog(main, {
      title: "เลือกไฟล์ .model3.json หรือโฟลเดอร์โมเดล Live2D",
      properties: ["openFile", "openDirectory"],
      filters: [{ name: "Live2D model", extensions: ["json"] }],
    });
    if (result.canceled) return { imported: 0, errors: [] };
    const imported = await models.importPath(result.filePaths[0]);
    refreshAvatar();
    return imported;
  });
  ipcMain.handle("dobby:import-core", async (event) => {
    check(event.sender.id);
    const result = await dialog.showOpenDialog(main, {
      title: "เลือก live2dcubismcore.min.js จาก Cubism SDK",
      properties: ["openFile"],
      filters: [{ name: "Cubism Core", extensions: ["js"] }],
    });
    if (result.canceled) return false;
    await models.importCore(result.filePaths[0]);
    refreshAvatar();
    return true;
  });
  ipcMain.handle("dobby:import-background", async (event, rawKind) => {
    const kind = z.enum(["image", "video"]).parse(rawKind);
    check(event.sender.id);
    const result = await dialog.showOpenDialog(main, {
      title:
        kind === "video"
          ? "เลือกวิดีโอพื้นหลังสำหรับฉากไลฟ์"
          : "เลือกรูปพื้นหลังสำหรับฉากไลฟ์",
      properties: ["openFile"],
      filters: [
        {
          name: kind === "video" ? "Background video" : "Background image",
          extensions:
            kind === "video" ? ["mp4", "webm"] : ["png", "jpg", "jpeg", "webp"],
        },
      ],
    });
    if (result.canceled) return false;
    if (kind === "video") await scenes.importVideo(result.filePaths[0]);
    else await scenes.importImage(result.filePaths[0]);
    refreshScene();
    return true;
  });
  ipcMain.on("dobby:avatar-ready", (event, raw) => {
    check(event.sender.id);
    const parsed = z
      .object({ id: z.string(), error: z.string().max(500).optional() })
      .safeParse(raw);
    if (!parsed.success || parsed.data.id !== core.state.avatar.selectedId)
      return;
    core.state.avatar.status = parsed.data.error ? "error" : "ready";
    core.state.avatar.error = parsed.data.error ?? "";
    core.publish();
  });
  ipcMain.handle("dobby:copy", (event, text) => {
    check(event.sender.id);
    clipboard.writeText(z.string().max(20_000).parse(text));
  });
  ipcMain.handle("dobby:output", (event) => {
    check(event.sender.id);
    if (outputWindow && !outputWindow.isDestroyed()) {
      outputWindow.restore();
      outputWindow.show();
      outputWindow.focus();
      return;
    }
    const output = new BrowserWindow({
      title: "Dobby · LIVE output",
      width: Math.round(
        (Math.min(
          760,
          (1000 * core.state.scene.height) / core.state.scene.width,
        ) *
          core.state.scene.width) /
          core.state.scene.height,
      ),
      height: Math.round(
        Math.min(
          760,
          (1000 * core.state.scene.height) / core.state.scene.width,
        ),
      ),
      useContentSize: true,
      backgroundColor: "#111720",
      webPreferences: {
        backgroundThrottling: false,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    outputWindow = output;
    output.on("closed", () => {
      outputWindow = null;
    });
    output.webContents.on("page-title-updated", (event) => {
      event.preventDefault();
      output.setTitle("Dobby · LIVE output");
    });
    output.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    output.webContents.on("will-navigate", (e) => e.preventDefault());
    void output.loadURL(core.state.output.url);
  });
  ipcMain.handle("dobby:mcp-config", (event) => {
    check(event.sender.id);
    return `[mcp_servers.dobby]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(join(__dirname, "mcp.mjs"))}, "--connection-file", ${JSON.stringify(connectionFile)}]\n\n[mcp_servers.dobby.env]\nELECTRON_RUN_AS_NODE = "1"\n`;
  });
  ipcMain.handle("dobby:command", async (event, raw) => {
    check(event.sender.id);
    const command = commandSchema.parse(raw);
    switch (command.type) {
      case "hostSettings":
        core.state.hostSettings = command.settings;
        await persist();
        break;
      case "clearMemory":
        if (core.state.autoHost.enabled)
          throw new Error("หยุด Auto Host ก่อนล้างความทรงจำ");
        await memory.clear();
        break;
      case "simulate":
        assertTestEventsAllowed();
        core.simulate(command.eventType);
        break;
      case "giftTiers":
        if (command.settings.bigAt <= command.settings.mediumAt)
          throw new Error("ระดับใหญ่ต้องมีค่ามากกว่าระดับกลาง");
        core.state.giftTiers = command.settings;
        await persist();
        break;
      case "regulars":
        core.state.regulars = { ...core.state.regulars, ...command.settings };
        refreshViewerCounts();
        await persist();
        break;
      case "forgetViewers":
        await viewers.clear();
        refreshViewerCounts();
        break;
      case "welcome":
        core.state.welcome = { ...command.settings, waiting: core.state.welcome.waiting };
        await persist();
        break;
      case "overlay":
        core.state.overlay = command.settings;
        await persist();
        break;
      case "debug":
        core.state.debug = command.settings.enabled
          ? command.settings
          : { enabled: false, rehearsal: false, injectOnLive: false };
        debug.note(
          "debug",
          `Debug ${core.state.debug.enabled ? "เปิด" : "ปิด"} · ซ้อมไม่ต้องเชื่อม Euler ${core.state.debug.rehearsal ? "เปิด" : "ปิด"} · ทดสอบระหว่างไลฟ์จริง ${core.state.debug.injectOnLive ? "เปิด" : "ปิด"}`,
        );
        break;
      case "testEvent": {
        if (!core.state.debug.enabled) throw new Error("เปิดโหมด Debug ก่อน");
        assertTestEventsAllowed();
        const { eventType, names, text, count, spacingMs } = command;
        debug.note("test", `ส่ง ${eventType} ×${count} จาก ${names.join(", ")}`);
        for (let i = 0; i < count; i++) {
          const send = () => {
            if (!core.state.debug.enabled) return;
            try {
              assertTestEventsAllowed();
            } catch {
              return;
            }
            core.testEvent(eventType, names[i % names.length], text);
          };
          if (i === 0 || spacingMs === 0) send();
          else setTimeout(send, i * spacingMs).unref();
        }
        break;
      }
      case "action":
        core.perform(command.action);
        break;
      case "pause":
        core.state.paused = command.paused;
        if (command.paused) core.perform("neutral");
        break;
      case "clearQueue":
        core.state.queue = [];
        break;
      case "removeJob":
        core.state.queue = core.state.queue.filter((j) => j.id !== command.id);
        break;
      case "character":
        core.state.character = command.character;
        await persist();
        break;
      case "rules":
        core.state.rules = command.rules;
        await persist();
        break;
      case "saveEuler": {
        euler.disconnect();
        core.state.euler.username = command.username.replace(/^@/, "");
        if (command.apiKey) apiKey = command.apiKey;
        if (!apiKey) throw new Error("กรอก Euler API key ก่อนบันทึก");
        if (command.remember) {
          if (!(await safeStorage.isAsyncEncryptionAvailable()))
            throw new Error("ระบบเก็บกุญแจยังไม่พร้อม เลือกใช้เฉพาะครั้งนี้");
          await writeFile(
            vaultFile,
            await safeStorage.encryptStringAsync(apiKey),
            { mode: 0o600 },
          );
        } else await unlink(vaultFile).catch(() => {});
        core.state.euler.hasKey = true;
        core.state.euler.message = command.remember
          ? "บันทึก key แบบเข้ารหัสแล้ว"
          : "พร้อมเชื่อมต่อ · ใช้ key เฉพาะครั้งนี้";
        await persist();
        break;
      }
      case "connectEuler":
        euler.connect(apiKey, core.state.euler.username);
        break;
      case "disconnectEuler":
        euler.disconnect();
        break;
      case "forgetEuler":
        euler.disconnect();
        apiKey = "";
        core.state.euler.hasKey = false;
        await unlink(vaultFile).catch(() => {});
        break;
      case "selectModel":
        await models.select(command.id);
        refreshAvatar();
        break;
      case "modelSettings":
        await models.settings(command.settings);
        refreshAvatar();
        break;
      case "modelMapping":
        await models.map(command.action, command.selection);
        refreshAvatar();
        break;
      case "emotionMapping":
        await models.mapEmotion(command.emotion, command.selection);
        refreshAvatar();
        break;
      case "emotion":
      {
        // Manual test from the model page: replays even the same mood, then returns to neutral.
        const at = Date.now();
        core.state.emotion = { name: command.emotion, at };
        setTimeout(() => {
          if (core.state.emotion.at === at && !core.state.autoHost.enabled)
            core.setEmotion("neutral");
        }, 3000).unref();
        break;
      }
      case "modelPlay":
        models.validatePlayback(command.selection);
        core.state.avatar.playback = { ...command.selection, at: Date.now() };
        break;
      case "scene":
        await scenes.update(command.settings);
        refreshScene();
        break;
    }
    core.publish();
    return core.state;
  });
  const audioSchema = z.object({
    level: z.number().min(0).max(1),
    active: z.boolean(),
  });
  ipcMain.on("dobby:audio", (event, data) => {
    check(event.sender.id);
    const parsed = audioSchema.safeParse(data);
    if (!parsed.success) return;
    const wasActive = core.state.audio.active;
    core.state.audio = parsed.data;
    // Mouth levels stream on their own lightweight channel; only on/off changes the app state.
    core.emit("audio", parsed.data);
    if (wasActive !== parsed.data.active) core.publish();
  });
  // The renderer re-renders on every state message, so bursts collapse to ≤10/s.
  const sendState = throttle(() => {
    if (main && !main.isDestroyed()) {
      main.webContents.send("dobby:state-changed", core.state);
      debug.ipcSent(() => JSON.stringify(core.state).length);
    }
  }, 100);
  core.on("change", sendState);
  const expiry = setInterval(() => { core.expire(); host.tick(); }, 500);
  app.on("window-all-closed", () => app.quit());
  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    host.dispose();
    debug.dispose();
    brain.dispose();
    clearInterval(expiry);
    sendState.cancel();
    euler.disconnect();
    voice.disconnect();
    void Promise.allSettled([memory.flush(), viewers.flush(), writing, local.close()])
      .finally(() => app.quit());
  });
}
