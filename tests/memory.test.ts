import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationMemory } from "../electron/memory";
import { DEFAULT_HOST_SETTINGS } from "../src/shared";
import { DobbyCore } from "../electron/core";
import { startLocalServer } from "../electron/server";

test("bounded memory survives restart, retrieves a returning viewer, and clearing removes persisted conversations", async () => {
  const folder = await mkdtemp(join(tmpdir(), "dobby-memory-"));
  try {
    const memory = new ConversationMemory(folder);
    await memory.load();
    for (let i = 0; i < 305; i++) memory.remember({ role: "viewer", name: `ผู้ชม ${i}`,
      viewerId: i === 10 ? "returning-viewer" : `viewer-${i}`, text: `ข้อความ ${i}`, at: i });
    await memory.flush();
    const file = join(folder, "conversation-memory.json");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    const restored = new ConversationMemory(folder); await restored.load();
    assert.equal(restored.count, 300);
    const context = restored.context(DEFAULT_HOST_SETTINGS, "reply", "returning-viewer");
    assert.equal(context.recentConversation.length, 30);
    assert.equal(context.viewerHistory[0].text, "ข้อความ 10");
    context.viewerHistory[0].text = "modified snapshot";
    assert.equal(restored.context(DEFAULT_HOST_SETTINGS, "reply", "returning-viewer").viewerHistory[0].text, "ข้อความ 10");
    await restored.clear();
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), []);
    const empty = new ConversationMemory(folder); await empty.load();
    assert.equal(empty.count, 0);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test("conversation context is private to the operator, absent from the broadcast stream", async () => {
  const memory = new ConversationMemory();
  memory.remember({ role: "viewer", viewerId: "private-viewer", name: "มะลิ", text: "memory-only-sentinel", at: 1 });
  const server = await startLocalServer(new DobbyCore(), tmpdir(), undefined, undefined, undefined, memory);
  const controller = new AbortController();
  try {
    const response = await fetch(server.origin + "/api/context", { method: "POST", headers: { Authorization: `Bearer ${server.operatorToken}` } });
    assert.ok(JSON.stringify(await response.json()).includes("memory-only-sentinel"));
    const output = await fetch(`${server.origin}/output/events?key=${server.outputToken}`, { signal: controller.signal });
    const first = new TextDecoder().decode((await output.body!.getReader().read()).value);
    assert.ok(!first.includes("memory-only-sentinel"));
    assert.ok(!first.includes("hostContext"));
  } finally { controller.abort(); await server.close(); }
});
