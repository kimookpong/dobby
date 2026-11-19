import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { DobbyCore } from "../electron/core";
import { ViewerRegistry } from "../electron/viewers";
import { AutoHost } from "../electron/auto-host";
import { WelcomeBatcher, welcomeText } from "../electron/welcome";
import type { DobbyVoice } from "../electron/voice";
import type { ViewerEvent } from "../src/shared";
import { DEFAULT_REGULARS, DEFAULT_WELCOME } from "../src/shared";
import { overlayView } from "../src/overlay-view";

const settle = () => new Promise<void>((r) => setImmediate(r));
let seq = 0;
const gift = (over: Partial<ViewerEvent>): ViewerEvent => ({
  id: `g${++seq}`, type: "gift", viewerId: "v1", name: "มะลิ", text: "Rose",
  count: 1, timestamp: 0, source: "euler", giftId: "rose", ...over,
});

test("gifts are tiered by total diamonds and big gifts are answered first", () => {
  const core = new DobbyCore();
  const actions: string[] = [];
  core.on("action", (a) => actions.push(a));
  core.ingest({ ...gift({}), id: "c1", type: "comment", viewerId: "c", name: "พลอย", text: "สวัสดี" });
  core.ingest(gift({ viewerId: "small", diamonds: 1 }));
  core.ingest(gift({ viewerId: "big", name: "Mochi", diamonds: 500, giftId: "lion" }));
  const tiers = core.state.queue.map((j) => j.giftTier ?? "-");
  assert.deepEqual(tiers, ["-", "small", "big"]);
  assert.equal(actions.at(-1), "surprised");
  assert.equal(core.claim()!.name, "Mochi");
});

test("a combo streak upgrades its tier and reacts again on upgrade", () => {
  const core = new DobbyCore();
  const actions: string[] = [];
  core.on("action", (a) => actions.push(a));
  core.ingest(gift({ streakId: "s", count: 1, diamonds: 5 }));
  assert.equal(core.state.queue[0].giftTier, "small");
  core.ingest(gift({ streakId: "s", count: 3, diamonds: 5 })); // +2 → 15 diamonds
  assert.equal(core.state.queue[0].giftTier, "medium");
  assert.equal(core.state.queue[0].priority, 1);
  assert.deepEqual(actions, ["heart", "happy"]);
});

test("a big gift gets a queue slot even when the queue is full", () => {
  const core = new DobbyCore();
  for (let i = 0; i < 20; i++)
    core.ingest({ ...gift({}), id: `c${i}`, type: "comment", viewerId: `c${i}`, text: "hi" });
  assert.equal(core.state.queue.length, 20);
  core.ingest(gift({ viewerId: "whale", diamonds: 1000 }));
  assert.equal(core.state.queue.length, 20);
  assert.equal(core.state.queue.at(-1)!.giftTier, "big");
});

test("viewer registry counts separate lives and flags the first comment of a visit", () => {
  let now = 0;
  const registry = new ViewerRegistry(undefined, () => now);
  const comment = { ...gift({}), type: "comment" as const, text: "hi", viewerId: "v" };
  assert.deepEqual(registry.record(comment, DEFAULT_REGULARS), { status: "new", visits: 1, firstCommentThisVisit: true });
  assert.equal(registry.record(comment, DEFAULT_REGULARS)!.firstCommentThisVisit, false);
  now += 4 * 3600_000;
  assert.deepEqual(registry.record(comment, DEFAULT_REGULARS), { status: "returning", visits: 2, firstCommentThisVisit: true });
  now += 4 * 3600_000;
  assert.equal(registry.record(comment, DEFAULT_REGULARS)!.status, "regular");
  // Demo events (random ids) are never remembered; disabling stops recording.
  assert.equal(registry.record({ ...comment, source: "demo", viewerId: "x" }, DEFAULT_REGULARS), null);
  assert.equal(registry.record(comment, { ...DEFAULT_REGULARS, enabled: false }), null);
});

test("returning joiners are welcomed back first", () => {
  let now = 0;
  const batcher = new WelcomeBatcher(() => now);
  batcher.add("1", "Nina", DEFAULT_WELCOME, "new");
  batcher.add("2", "มะลิ", DEFAULT_WELCOME, "regular");
  now = 3_000;
  const batch = batcher.take(DEFAULT_WELCOME)!;
  assert.deepEqual(batch.names, ["มะลิ", "Nina"]);
  assert.equal(welcomeText(batch), "กลับมาอีกครั้ง: มะลิ · ชื่อ: Nina");
});

class HostVoice extends EventEmitter {
  state = { status: "connected", mode: "host", preview: false, speaking: false };
  calls: Record<string, unknown>[] = [];
  async respondAudience(data: Record<string, unknown>) {
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

test("Auto Host tells the voice model about regulars and gift tiers, and the card shows it", async () => {
  let now = 0;
  const core = new DobbyCore({}, () => now);
  core.state.euler.status = "connected";
  core.state.overlay = { ...core.state.overlay, replyCard: true };
  const registry = new ViewerRegistry(undefined, () => now);
  const voice = new HostVoice();
  const host = new AutoHost(core, voice as unknown as DobbyVoice, undefined, undefined, () => now, registry);
  try {
    // Two earlier lives make this viewer "returning".
    core.ingest({ ...gift({}), id: "old1", type: "comment", text: "เก่า", viewerId: "fan" });
    now += 4 * 3600_000;
    core.state.queue = [];
    host.start();
    core.ingest({ ...gift({}), id: "new1", type: "comment", text: "กลับมาแล้ว", viewerId: "fan" });
    await settle();
    assert.deepEqual(voice.calls[0].viewer, { status: "returning", visits: 2, firstCommentThisVisit: true });
    assert.equal(overlayView(core.state).card!.label, "กำลังตอบ · กลับมาอีกครั้ง");
    now += 20_000;
    voice.finish();
    core.ingest(gift({ viewerId: "whale", name: "Mochi", diamonds: 300 }));
    await settle();
    assert.equal(voice.calls[1].giftTier, "big");
    assert.equal(overlayView(core.state).card!.tone, "big");
  } finally {
    host.dispose();
  }
});
