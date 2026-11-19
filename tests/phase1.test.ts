import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { throttle } from "../electron/throttle";
import { DobbyCore } from "../electron/core";
import { startLocalServer } from "../electron/server";
import { AutoHost } from "../electron/auto-host";
import { DebugMonitor } from "../electron/debug";
import { DobbyBrain } from "../electron/brain";
import type { DobbyVoice } from "../electron/voice";
import type { CodexRpc } from "../electron/codex-rpc";
import type { ReplyTiming } from "../src/shared";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = () => new Promise<void>((r) => setImmediate(r));

test("throttle runs the first call now and collapses a burst into one trailing call", async () => {
  let calls = 0;
  const run = throttle(() => calls++, 40);
  for (let i = 0; i < 50; i++) run();
  assert.equal(calls, 1);
  await wait(70);
  assert.equal(calls, 2);
  run.cancel();
});

test("mouth audio streams as a small SSE event without republishing app state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dobby-audio-"));
  const core = new DobbyCore();
  const server = await startLocalServer(core, dir);
  const controller = new AbortController();
  let publishes = 0;
  core.on("change", () => publishes++);
  try {
    const response = await fetch(
      `${server.origin}/output/events?key=${server.outputToken}`,
      { signal: controller.signal },
    );
    const reader = response.body!.getReader();
    await reader.read(); // initial state
    publishes = 0;
    core.emit("audio", { level: 0.5, active: true });
    const chunk = new TextDecoder().decode((await reader.read()).value);
    assert.ok(chunk.startsWith("event: audio"));
    assert.ok(chunk.includes('"level":0.500'));
    assert.ok(!chunk.includes("avatar"));
    assert.equal(publishes, 0);
  } finally {
    controller.abort();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

class HostVoice extends EventEmitter {
  state = { status: "connected", mode: "host", preview: false, speaking: false };
  async respondAudience() {
    this.state.speaking = true;
    this.emit("change");
  }
  keepAlive() {}
  disconnect() {}
  finish() {
    this.state.speaking = false;
    this.emit("change");
    this.emit("utteranceFinished");
  }
}

test("debug rehearsal runs Auto Host without Euler and records reply timings", async () => {
  let clock = 1_000;
  const now = () => clock;
  const core = new DobbyCore({}, now);
  const voice = new HostVoice();
  const host = new AutoHost(core, voice as unknown as DobbyVoice, undefined, undefined, now);
  const monitor = new DebugMonitor(core);
  const timings: ReplyTiming[] = [];
  core.on("debug:reply", (t: ReplyTiming) => timings.push(t));
  try {
    assert.throws(() => host.start(), /Euler/);
    core.state.debug = { enabled: true, rehearsal: true, injectOnLive: false };
    host.start();
    core.testEvent("comment", "🌸มะลิ🌸", "สวัสดี");
    await settle();
    assert.equal(core.state.autoHost.status, "answering");
    clock += 2_500;
    voice.finish();
    await settle();
    assert.equal(timings.length, 1);
    assert.equal(timings[0].name, "🌸มะลิ🌸");
    assert.equal(timings[0].ok, true);
    assert.equal(timings[0].speakMs, 2_500);
    assert.equal(monitor.snapshot().replies.length, 1);
    // A second test event from the same name is the same viewer.
    core.testEvent("comment", "🌸มะลิ🌸", "อีกครั้ง");
    assert.equal(core.state.events[0].viewerId, core.state.events[1].viewerId);
    core.state.debug = { enabled: true, rehearsal: false, injectOnLive: false };
    core.publish();
    assert.equal(core.state.autoHost.enabled, false);
  } finally {
    host.dispose();
    monitor.dispose();
  }
});

test("text-model brain reuses one Codex process across replies and releases it on cancel", async () => {
  const folder = await mkdtemp(join(tmpdir(), "dobby-warm-"));
  const created: FakeRpc[] = [];
  let thread = 0;
  class FakeRpc extends EventEmitter {
    starts = 0;
    closed = false;
    constructor() {
      super();
      created.push(this);
    }
    async start() {
      this.starts++;
    }
    close() {
      this.closed = true;
      this.emit("disconnected", "closed");
    }
    async call(method: string) {
      if (method === "config/read") return { config: {} };
      if (method === "thread/start")
        return { model: "m", thread: { id: `t${++thread}` } };
      if (method === "turn/start") {
        const id = `t${thread}`;
        queueMicrotask(() => {
          this.emit("notification", "item/completed", {
            threadId: id,
            item: { type: "agentMessage", text: JSON.stringify({ reply: "ok" }) },
          });
          this.emit("notification", "turn/completed", {
            threadId: id,
            turn: { status: "completed" },
          });
        });
      }
      return {};
    }
  }
  const brain = new DobbyBrain(folder, () => new FakeRpc() as unknown as CodexRpc, async () => "/codex");
  brain.state.models = [{ id: "m", name: "M", description: "", default: true, effort: null }];
  brain.state.selectedId = "m";
  const core = new DobbyCore();
  try {
    const audience = { name: "a", text: "hi", type: "comment" };
    assert.equal(await brain.respond(core.state.character, audience), "ok");
    assert.equal(await brain.respond(core.state.character, audience), "ok");
    assert.equal(created.length, 1);
    assert.equal(created[0].starts, 1);
    assert.equal(created[0].closed, false);
    assert.equal(created[0].listenerCount("notification"), 0);
    brain.cancel();
    assert.equal(created[0].closed, true);
  } finally {
    brain.dispose();
    await rm(folder, { recursive: true, force: true });
  }
});
