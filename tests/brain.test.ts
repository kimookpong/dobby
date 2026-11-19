import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DobbyBrain } from "../electron/brain";
import type { CodexRpc } from "../electron/codex-rpc";
import { DobbyCore } from "../electron/core";
import { ConversationMemory } from "../electron/memory";

test("fresh text-model threads receive VTuber identity, mode configuration and conversation memory without enabling tools", async () => {
  const folder = await mkdtemp(join(tmpdir(), "dobby-brain-"));
  const calls: { method: string; params: any }[] = [];
  class FakeRpc extends EventEmitter {
    async start() {}
    close() {}
    async call(method: string, params: any) {
      calls.push({ method, params });
      if (method === "config/read") return { config: { mcp_servers: { dobby: {}, another: {} } } };
      if (method === "thread/start") return { model: "test-model", thread: { id: "text-thread" } };
      if (method === "turn/start") queueMicrotask(() => {
        this.emit("notification", "item/completed", { threadId: "text-thread", item: {
          type: "agentMessage", text: JSON.stringify({ reply: "ฉันชื่อเมกุมิ เป็น AI VTuber ค่ะ" }),
        } });
        this.emit("notification", "turn/completed", { threadId: "text-thread", turn: { status: "completed" } });
      });
      return {};
    }
  }
  const brain = new DobbyBrain(folder, () => new FakeRpc() as unknown as CodexRpc, async () => "/test/codex");
  brain.state.models = [{ id: "test-model", name: "Test", description: "", default: true, effort: null }];
  brain.state.selectedId = "test-model";
  const core = new DobbyCore();
  const memory = new ConversationMemory();
  memory.remember({ role: "viewer", name: "มะลิ", text: "เราอยากฟังนิทานแมว", at: 1 });
  const context = memory.context({ mode: "story", storyPrompt: "แมวจอมเวท", productInfo: "" }, "reply");
  try {
    const reply = await brain.respond({ ...core.state.character, name: "เมกุมิ" }, { name: "พลอย", text: "ชื่ออะไร", type: "comment" }, context);
    assert.ok(reply.includes("AI VTuber"));
    const thread = calls.find((c) => c.method === "thread/start")!.params;
    assert.ok(thread.baseInstructions.includes("AI VTuber"));
    assert.ok(thread.baseInstructions.includes("Do not volunteer ChatGPT"));
    assert.ok(thread.baseInstructions.includes("answer honestly"));
    assert.deepEqual(thread.config, { "mcp_servers.dobby.enabled": false, "mcp_servers.another.enabled": false });
    const turn = calls.find((c) => c.method === "turn/start")!.params;
    assert.deepEqual(JSON.parse(turn.input[0].text).hostContext, context);
    assert.equal(JSON.parse(turn.input[0].text).audienceEvent.text, "ชื่ออะไร");
  } finally { brain.dispose(); await rm(folder, { recursive: true, force: true }); }
});
