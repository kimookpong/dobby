import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { DobbyCore } from "../electron/core";
import type { DobbyVoice } from "../electron/voice";
import { AutoHost } from "../electron/auto-host";
import type { HostContext } from "../src/shared";
import type { DobbyBrain } from "../electron/brain";
class HostVoice extends EventEmitter {
  state = {
    status: "connected",
    mode: "host",
    preview: false,
    speaking: false,
  };
  calls: unknown[] = [];
  contexts: (HostContext | undefined)[] = [];
  alive = false;
  async respondAudience(data: unknown, context?: HostContext) {
    this.calls.push(data);
    this.contexts.push(context);
    this.state.speaking = true;
    this.emit("change");
  }
  keepAlive(active: boolean) {
    this.alive = active;
  }
  disconnect() {
    this.state.status = "disconnected";
    this.state.speaking = false;
    this.emit("change");
  }
  finish() {
    this.state.speaking = false;
    this.emit("change");
    this.emit("utteranceFinished");
  }
}
const settle = () => new Promise<void>((r) => setImmediate(r));
function setup(now?: () => number) {
  const core = new DobbyCore({}, now),
    voice = new HostVoice();
  core.state.euler.status = "connected";
  const host = new AutoHost(core, voice as unknown as DobbyVoice, undefined, undefined, now);
  return { core, voice, host };
}
test("Auto Host stays off until explicitly started and answers the queued audience serially", async () => {
  const { core, voice, host } = setup();
  try {
    core.simulate("comment");
    await settle();
    assert.equal(voice.calls.length, 0);
    assert.equal(core.state.autoHost.enabled, false);
    host.start();
    await settle();
    assert.equal(voice.calls.length, 1);
    assert.equal(core.state.queue[0].status, "claimed");
    assert.equal(voice.alive, true);
    core.simulate("comment");
    await settle();
    assert.equal(voice.calls.length, 1);
    voice.emit("transcript", "สวัสดี ยินดีต้อนรับนะ");
    assert.equal(core.state.autoHost.lastReply, "สวัสดี ยินดีต้อนรับนะ");
    voice.finish();
    await settle();
    assert.equal(voice.calls.length, 2);
    assert.equal(core.state.autoHost.answered, 1);
    voice.finish();
    await settle();
    assert.equal(core.state.queue.length, 0);
    assert.equal(core.state.autoHost.answered, 2);
    assert.equal(core.state.autoHost.status, "waiting");
  } finally {
    host.dispose();
  }
});

test("silence triggers at 15 seconds, resets after playback, and never overlaps or runs while paused/stopped", async () => {
  let now = 100_000;
  const { core, voice, host } = setup(() => now);
  try {
    host.start();
    now += 14_999; host.tick(); await settle();
    assert.equal(voice.calls.length, 0);
    now++; host.tick(); await settle();
    assert.equal(voice.calls.length, 1);
    assert.equal(voice.contexts[0]?.task, "idle");
    assert.equal(core.state.queue.length, 0);
    now += 30_000; host.tick(); await settle();
    assert.equal(voice.calls.length, 1);
    voice.emit("transcript", "สวัสดีทุกคน วันนี้อยากคุยเรื่องอะไรดี");
    voice.finish(); await settle();
    assert.equal(core.state.autoHost.answered, 0);
    now += 14_999; host.tick(); await settle();
    assert.equal(voice.calls.length, 1);
    core.state.paused = true;
    now++; host.tick(); await settle();
    assert.equal(voice.calls.length, 1);
    core.state.paused = false; core.publish(); await settle();
    assert.equal(voice.calls.length, 2);
    assert.ok(voice.contexts[1]?.recentConversation.some((e) => e.role === "host"));
    host.stop(); voice.finish(); now += 60_000; host.tick(); await settle();
    assert.equal(voice.calls.length, 2);
  } finally { host.dispose(); }
});

test("viewer replies win over idle segments and viewer-to-viewer comments remain in memory even when not queued", async () => {
  let now = 100_000;
  const { core, voice, host } = setup(() => now);
  try {
    core.state.rules.find((r) => r.type === "comment")!.enqueue = false;
    const event = { id: "memory-a", type: "comment" as const, viewerId: "mali", name: "มะลิ",
      text: "คุณพลอย เมื่อวานเราไปเที่ยวทะเลมา", count: 1, timestamp: now, source: "euler" as const };
    core.ingest(event); core.ingest(event);
    assert.equal(core.state.memory.count, 1);
    assert.equal(core.state.queue.length, 0);
    core.state.rules.find((r) => r.type === "comment")!.enqueue = true;
    host.start(); now += 15_000;
    core.ingest({ ...event, id: "memory-b", viewerId: "ploy", name: "พลอย", text: "มะลิ ทะเลสวยไหม" });
    host.tick(); await settle();
    assert.equal(voice.calls.length, 1);
    assert.equal(voice.contexts[0]?.task, "reply");
    assert.equal(voice.contexts[0]?.recentConversation.length, 2);
    voice.emit("transcript", "มะลิเล่าให้พลอยฟังหน่อยสิว่าทะเลเป็นยังไง");
    voice.finish(); await settle();
    assert.equal(core.state.memory.count, 3);
  } finally { host.dispose(); }
});

test("story and sales settings reach the realtime host and story segments include previous narration", async () => {
  let now = 100_000;
  const { core, voice, host } = setup(() => now);
  try {
    core.state.hostSettings = { mode: "story", storyPrompt: "แมวอวกาศตามหาดวงจันทร์", productInfo: "" };
    host.start(); now += 15_000; host.tick(); await settle();
    assert.equal(voice.contexts[0]?.settings.mode, "story");
    voice.emit("transcript", "เจ้าแมวขึ้นยานไปยังดวงจันทร์สีม่วง");
    voice.finish(); await settle();
    now += 15_000; host.tick(); await settle();
    assert.equal(voice.contexts[1]?.recentConversation.at(-1)?.text, "เจ้าแมวขึ้นยานไปยังดวงจันทร์สีม่วง");
    voice.finish(); await settle();
    core.state.hostSettings = { mode: "sales", storyPrompt: "", productInfo: "แก้วสีเขียว 199 บาท" };
    core.simulate("comment"); await settle();
    assert.equal(voice.contexts[2]?.settings.productInfo, "แก้วสีเขียว 199 บาท");
    assert.equal(voice.contexts[2]?.settings.mode, "sales");
  } finally { host.dispose(); }
});

test("an idle text answer is discarded if a viewer arrives while it is being generated", async () => {
  let now = 100_000;
  let resolve!: (text: string) => void;
  const calls: HostContext[] = [];
  const core = new DobbyCore({}, () => now);
  core.state.euler.status = "connected";
  const voice = new HostVoice();
  const brain = { state: { selectedId: "text-model" }, cancel() {},
    respond(_character: unknown, _event: unknown, context: HostContext) {
      calls.push(context);
      return new Promise<string>((done) => { resolve = done; });
    } };
  const host = new AutoHost(core, voice as unknown as DobbyVoice, brain as unknown as DobbyBrain, undefined, () => now);
  try {
    host.start(); now += 15_000; host.tick(); await settle();
    core.simulate("comment");
    resolve("ชวนคุยที่ยังไม่ต้องพูด"); await settle();
    assert.deepEqual(calls.map((c) => c.task), ["idle", "reply"]);
    assert.equal(voice.calls.length, 0);
  } finally { host.dispose(); resolve("ยกเลิก"); await settle(); }
});
test("pausing prevents new host replies and expired jobs are never replayed", async () => {
  let now = 100000;
  const { core, voice, host } = setup(() => now);
  try {
    core.simulate("comment");
    now += 31000;
    host.start();
    await settle();
    assert.equal(voice.calls.length, 0);
    core.state.paused = true;
    core.simulate("comment");
    await settle();
    assert.equal(voice.calls.length, 0);
    core.state.paused = false;
    core.simulate("comment");
    await settle();
    assert.equal(voice.calls.length, 1);
  } finally {
    host.dispose();
  }
});
test("host refuses missing live/voice connections and stops when either disconnects", async () => {
  const { core, voice, host } = setup();
  try {
    core.state.euler.status = "disconnected";
    assert.throws(() => host.start(), /Euler/);
    core.state.euler.status = "connected";
    voice.state.mode = "speech";
    assert.throws(() => host.start(), /Auto Host/);
    voice.state.mode = "host";
    host.start();
    core.simulate("comment");
    await settle();
    core.state.euler.status = "disconnected";
    core.publish();
    assert.equal(core.state.autoHost.enabled, false);
    assert.equal(voice.state.status, "disconnected");
    assert.equal(core.state.queue.length, 0);
  } finally {
    host.dispose();
  }
});
test("stopping during an in-flight response prevents processing the next audience message", async () => {
  const { core, voice, host } = setup();
  try {
    host.start();
    core.simulate("comment");
    core.simulate("comment");
    await settle();
    assert.equal(voice.calls.length, 1);
    host.stop();
    voice.finish();
    await settle();
    assert.equal(voice.calls.length, 1);
    assert.equal(core.state.autoHost.enabled, false);
    assert.equal(core.state.autoHost.answered, 0);
  } finally {
    host.dispose();
  }
});
