import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { DobbyCore } from "../electron/core";
import { AutoHost } from "../electron/auto-host";
import { ConversationMemory } from "../electron/memory";
import type { DobbyVoice } from "../electron/voice";
import type { HostContext } from "../src/shared";

const settle = () => new Promise<void>((r) => setImmediate(r));
const settings = { mode: "conversation" as const, storyPrompt: "", productInfo: "" };

test("realtime context: full history once, then only new viewer messages", () => {
  const memory = new ConversationMemory();
  for (let i = 1; i <= 5; i++) memory.remember({ role: "viewer", viewerId: "a", name: "A", text: `m${i}`, at: i });
  memory.remember({ role: "host", name: "Dobby", text: "reply", at: 6 });
  const first = memory.contextSince(settings, "reply", "a", 0, true);
  assert.equal(first.recentConversation.length, 6);
  memory.remember({ role: "viewer", viewerId: "b", name: "B", text: "new", at: 7 });
  memory.remember({ role: "host", name: "Dobby", text: "own words", at: 8 });
  const next = memory.contextSince(settings, "reply", "a", 6, false);
  assert.deepEqual(next.recentConversation.map((e) => e.text), ["new"]);
  assert.deepEqual(next.viewerHistory, []);
});

class HostVoice extends EventEmitter {
  state = { status: "connected", mode: "host", preview: false, speaking: false };
  contexts: (HostContext | undefined)[] = [];
  async respondAudience(_d: unknown, context?: HostContext) {
    this.contexts.push(context);
    this.state.speaking = true;
    this.emit("change");
  }
  keepAlive() {}
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

test("Auto Host sends the voice session only what it has not seen, and resets on restart", async () => {
  let now = 1_000;
  const core = new DobbyCore({}, () => now);
  core.state.euler.status = "connected";
  const voice = new HostVoice();
  const memory = new ConversationMemory();
  for (let i = 0; i < 10; i++) memory.remember({ role: "viewer", viewerId: `old${i}`, name: "Old", text: `old ${i}`, at: i + 1 });
  const host = new AutoHost(core, voice as unknown as DobbyVoice, undefined, memory, () => now);
  try {
    host.start();
    now += 100;
    core.testEvent("comment", "มะลิ", "สวัสดี");
    await settle();
    const first = voice.contexts[0]!.recentConversation.length;
    assert.ok(first >= 10);
    now += 100;
    voice.finish();
    now += 100;
    core.testEvent("comment", "พลอย", "หวัดดี");
    await settle();
    assert.deepEqual(voice.contexts[1]!.recentConversation.map((e) => e.text), ["หวัดดี"]);
    // A new session (stop/start) gets the full context again.
    host.stop();
    voice.finish();
    host.start();
    now += 20_000;
    core.testEvent("comment", "Nina", "hi");
    await settle();
    assert.ok(voice.contexts[2]!.recentConversation.length > 1);
  } finally {
    host.dispose();
  }
});

test("a dropped voice session marks Auto Host recoverable; stopping by hand does not", async () => {
  const core = new DobbyCore();
  core.state.euler.status = "connected";
  const voice = new HostVoice();
  const host = new AutoHost(core, voice as unknown as DobbyVoice);
  try {
    host.start();
    voice.disconnect();
    assert.equal(core.state.autoHost.enabled, false);
    assert.equal(core.state.autoHost.recoverable, true);
    voice.state.status = "connected";
    host.start();
    assert.equal(core.state.autoHost.recoverable, false);
    host.stop();
    assert.equal(core.state.autoHost.recoverable, false);
  } finally {
    host.dispose();
  }
});
