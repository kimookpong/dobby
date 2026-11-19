import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { speakableName } from "../src/viewer-name";
import { WelcomeBatcher, welcomeText } from "../electron/welcome";
import { DobbyCore } from "../electron/core";
import { AutoHost } from "../electron/auto-host";
import type { DobbyVoice } from "../electron/voice";
import { DEFAULT_WELCOME } from "../src/shared";
import { overlayView } from "../src/overlay-view";

const settle = () => new Promise<void>((r) => setImmediate(r));

test("display names become sayable or are dropped", () => {
  assert.equal(speakableName("🌸มะลิ🌸"), "มะลิ");
  assert.equal(speakableName("꧁พลอย꧂"), "พลอย");
  assert.equal(speakableName("NightOwl_1999"), "NightOwl");
  assert.equal(speakableName("user8823412"), null);
  assert.equal(speakableName("🔥🔥🔥"), null);
  assert.equal(speakableName("𝓜𝓸𝓬𝓱𝓲"), "Mochi");
  assert.equal(speakableName("ก่อนหน้าน้ำตาจะไหลลงมาอีกครั้งหนึ่ง")!.length <= 20, true);
});

test("joins are grouped, spaced out, capped and not re-greeted", () => {
  let now = 0;
  const batcher = new WelcomeBatcher(() => now);
  const settings = { ...DEFAULT_WELCOME };
  for (const [id, name] of [["1", "มะลิ"], ["2", "พลอย"], ["3", "Mochi"], ["4", "Nina"], ["5", "user123"]])
    batcher.add(id, name, settings);
  assert.equal(batcher.take(settings), null); // gathering window
  now = 3_000;
  const first = batcher.take(settings)!;
  assert.deepEqual(first, { names: ["มะลิ", "พลอย", "Mochi"], returning: [], others: 2 });
  assert.equal(welcomeText(first), "ชื่อ: มะลิ, พลอย, Mochi · และอีก 2 คน");
  batcher.add("1", "มะลิ", settings); // rejoin within regreet window
  batcher.add("6", "Kai", settings);
  now = 10_000;
  assert.equal(batcher.take(settings), null); // interval not reached
  now = 30_000;
  assert.deepEqual(batcher.take(settings), { names: ["Kai"], returning: [], others: 0 });
  batcher.add("7", "Off", { ...settings, enabled: false });
  assert.equal(batcher.waiting, 0);
});

class HostVoice extends EventEmitter {
  state = { status: "connected", mode: "host", preview: false, speaking: false };
  calls: { name: string; text: string; type: string }[] = [];
  async respondAudience(data: { name: string; text: string; type: string }) {
    this.calls.push(data);
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

test("Auto Host answers comments first, then greets joiners together before idle chatter", async () => {
  let now = 100_000;
  const core = new DobbyCore({}, () => now);
  core.state.euler.status = "connected";
  core.state.overlay = { ...core.state.overlay, replyCard: true };
  const voice = new HostVoice();
  const host = new AutoHost(core, voice as unknown as DobbyVoice, undefined, undefined, () => now);
  try {
    host.start();
    core.testEvent("join", "🌸มะลิ🌸", "");
    core.testEvent("join", "user99881", "");
    core.testEvent("comment", "พลอย", "สวัสดี");
    await settle();
    assert.equal(voice.calls[0].type, "comment");
    now += 5_000;
    voice.finish();
    await settle();
    host.tick();
    await settle();
    assert.equal(voice.calls.length, 2);
    assert.deepEqual(voice.calls[1], { name: "มะลิ", text: "ชื่อ: มะลิ · และอีก 1 คน", type: "welcome" });
    const card = overlayView(core.state).card!;
    assert.equal(card.label, "ยินดีต้อนรับ");
    assert.equal(card.name, "มะลิ");
    assert.equal(card.text, "และอีก 1 คน");
    assert.equal(core.state.emotion.name, "happy");
    voice.finish();
    await settle();
    // Nobody waiting to be greeted: the next turn is idle chatter after 15s.
    now += 15_000;
    host.tick();
    await settle();
    assert.equal(voice.calls[2].type, "idle");
  } finally {
    host.dispose();
  }
});
