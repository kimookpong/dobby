import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DobbyCore } from "../electron/core";
import { startLocalServer } from "../electron/server";
import { cleanOverlayText, overlayView } from "../src/overlay-view";

test("overlay text strips control/bidi characters, masks blocked words and caps length", () => {
  assert.equal(cleanOverlayText("  สวัสดี\n‮คุณ  ", [], 50), "สวัสดี คุณ");
  assert.equal(cleanOverlayText("ไอ้บ้า มาแล้ว", ["บ้า"], 50), "ไอ้*** มาแล้ว");
  assert.equal(cleanOverlayText("BadWord here", ["badword"], 50), "****** here");
  const long = cleanOverlayText("ก".repeat(200), [], 10);
  assert.equal([...long].length, 10);
  assert.ok(long.endsWith("…"));
});

test("overlay shows nothing until enabled, then only the current reply turn", () => {
  const core = new DobbyCore();
  const host = core.state.autoHost;
  Object.assign(host, {
    enabled: true,
    status: "answering",
    turnId: 3,
    turnKind: "reply",
    lastQuestion: { name: "มะลิ", text: "สบายดีไหม" },
    lastReply: "สบายดีค่ะ",
  });
  let view = overlayView(core.state);
  assert.equal(view.card, null);
  assert.equal(view.caption, null);
  core.state.overlay = { ...core.state.overlay, subtitles: true, replyCard: true };
  view = overlayView(core.state);
  assert.deepEqual(view.card, { turnId: 3, label: "กำลังตอบ", name: "มะลิ", text: "สบายดีไหม" });
  assert.deepEqual(view.caption, { turnId: 3, text: "สบายดีค่ะ", speaking: true });
  // Idle chatter has no viewer to show; finished turns keep the caption for the linger fade.
  host.turnKind = "idle";
  assert.equal(overlayView(core.state).card, null);
  host.status = "waiting";
  assert.equal(overlayView(core.state).caption?.speaking, false);
  host.enabled = false;
  assert.equal(overlayView(core.state).caption, null);
});

test("broadcast output carries the viewer card only when the operator enables it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dobby-overlay-"));
  const core = new DobbyCore();
  Object.assign(core.state.autoHost, {
    enabled: true,
    status: "answering",
    turnId: 1,
    turnKind: "reply",
    lastQuestion: { name: "viewer-sentinel", text: "hello" },
    lastReply: "hi",
  });
  const server = await startLocalServer(core, dir);
  const controller = new AbortController();
  try {
    const response = await fetch(
      `${server.origin}/output/events?key=${server.outputToken}`,
      { signal: controller.signal },
    );
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.ok(!first.includes("viewer-sentinel"));
    core.state.overlay = { ...core.state.overlay, replyCard: true, blockedWords: ["hello"] };
    core.publish();
    const next = new TextDecoder().decode((await reader.read()).value);
    assert.ok(next.includes("viewer-sentinel"));
    assert.ok(!next.includes("hello"));
    assert.ok(!next.includes("blockedWords"));
  } finally {
    controller.abort();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
