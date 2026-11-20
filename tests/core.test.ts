import { test } from "node:test";
import assert from "node:assert/strict";
import { DobbyCore } from "../electron/core";
import { normalizeEuler } from "../electron/euler";
import type { ViewerEvent } from "../src/shared";

function event(patch: Partial<ViewerEvent> = {}): ViewerEvent {
  return {
    id: "a",
    viewerId: "u1",
    name: "Mali",
    type: "comment",
    text: "Hello",
    count: 1,
    source: "euler",
    timestamp: 100_000,
    ...patch,
  };
}
test("replayed events do not duplicate counters, actions or queue", () => {
  const core = new DobbyCore({}, () => 100_000);
  assert.equal(core.ingest(event()), true);
  assert.equal(core.ingest(event()), false);
  assert.equal(core.state.stats.comments, 1);
  assert.equal(core.state.queue.length, 1);
});
test("gift streak increments count by delta and ignores the final repeated total", () => {
  const core = new DobbyCore({}, () => 100_000);
  core.ingest(
    event({
      id: "g1",
      type: "gift",
      count: 1,
      giftId: "rose",
      streakId: "s1",
      streaking: true,
    }),
  );
  core.ingest(
    event({
      id: "g2",
      type: "gift",
      count: 5,
      giftId: "rose",
      streakId: "s1",
      streaking: true,
    }),
  );
  core.ingest(
    event({
      id: "g3",
      type: "gift",
      count: 5,
      giftId: "rose",
      streakId: "s1",
      streaking: false,
    }),
  );
  assert.equal(core.state.stats.gifts, 5);
  assert.equal(core.state.events.length, 2);
  assert.match(core.state.queue[0].text, /×5$/);
  core.ingest(
    event({ id: "g4", type: "gift", count: 2, giftId: "rose", streakId: "s2" }),
  );
  assert.equal(core.state.stats.gifts, 7);
});
test("pause records events but suppresses new reactions and claims", () => {
  const core = new DobbyCore({}, () => 100_000);
  core.state.paused = true;
  core.ingest(event({ type: "gift" }));
  assert.equal(core.state.stats.gifts, 1);
  assert.equal(core.state.action.name, "neutral");
  assert.equal(core.claim(), null);
  assert.equal(core.state.queue.length, 0);
});
test("queue is bounded, claims exclusive and expired jobs cannot complete", () => {
  let now = 100_000;
  const core = new DobbyCore({}, () => now);
  for (let i = 0; i < 50; i++)
    core.ingest(event({ id: `e${i}`, viewerId: `u${i}` }));
  assert.equal(core.state.queue.length, 20);
  const claimed = core.claim()!;
  assert.ok(claimed);
  assert.equal(core.claim(), null);
  now += 91_000;
  core.expire();
  // Waiting comments expire; the job being spoken survives until its own limit.
  assert.deepEqual(core.state.queue.map((j) => j.id), [claimed.id]);
  now += 30_000;
  core.expire();
  assert.equal(core.state.queue.length, 0);
  assert.throws(() => core.finish(claimed.id));
});
test("burst comments: newest answered first, stale ones dropped and reported", () => {
  let now = 100_000;
  const core = new DobbyCore({}, () => now);
  const dropped: string[] = [];
  core.on("queue:dropped", (jobs: { name: string }[]) => dropped.push(...jobs.map((j) => j.name)));
  for (const name of ["a", "b", "c"]) {
    core.ingest(event({ id: name, viewerId: name, name }));
    now += 1_000;
  }
  const first = core.claim()!;
  assert.equal(first.name, "c");
  // A long reply (>30s) still finishes and the older comments are still waiting.
  now += 45_000;
  core.finish(first.id);
  assert.equal(core.claim()!.name, "b");
  now += 60_000;
  core.expire();
  assert.deepEqual(dropped, ["a"]);
});
test("gift thank-yous wait longer than comments", () => {
  let now = 100_000;
  const core = new DobbyCore({}, () => now);
  core.ingest(event({ id: "c", viewerId: "c" }));
  core.ingest(event({ id: "g", viewerId: "g", type: "gift", text: "Rose", giftId: "1", streakId: "s" }));
  now += 120_000;
  core.expire();
  assert.deepEqual(core.state.queue.map((j) => j.type), ["gift"]);
});
test("viewer cooldown prevents queue flooding without hiding comments", () => {
  const core = new DobbyCore({}, () => 100_000);
  core.ingest(event());
  core.ingest(event({ id: "b" }));
  assert.equal(core.state.events.length, 2);
  assert.equal(core.state.queue.length, 1);
});
test("Euler v3 frames preserve large IDs and normalize gift streak metadata", () => {
  const normalized = normalizeEuler({
    type: "WebcastGiftMessage",
    data: {
      common: { msgId: "9999999999999999999" },
      user: { id: "8888888888888888888", nickname: "Mali" },
      giftId: "5655",
      gift: { name: "Rose" },
      repeatCount: 5,
      repeatEnd: 0,
      groupId: "g123",
    },
  });
  assert.equal(normalized?.id, "9999999999999999999");
  assert.equal(normalized?.viewerId, "8888888888888888888");
  assert.equal(normalized?.streakId, "g123");
  assert.equal(normalized?.count, 5);
  assert.equal(
    normalizeEuler({
      type: "WebcastSocialMessage",
      data: { action: "3", user: { id: "1" } },
    }),
    null,
  );
  assert.equal(normalizeEuler({ type: "unknown" }), null);
});
