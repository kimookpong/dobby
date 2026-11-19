import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DobbyCore } from "../electron/core";
import { startLocalServer } from "../electron/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("broadcast output streams avatar changes without exposing the private queue or persona", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dobby-output-"));
  const core = new DobbyCore();
  core.state.character.personality = "private-persona-sentinel";
  core.simulate("comment");
  const server = await startLocalServer(core, dir);
  const controller = new AbortController();
  try {
    const response = await fetch(
      `${server.origin}/output/events?key=${server.outputToken}`,
      { signal: controller.signal },
    );
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.ok(first.includes("Dobby"));
    assert.ok(!first.includes("private-persona-sentinel"));
    assert.ok(!first.includes("queue"));
    core.perform("heart", "Mali");
    const next = new TextDecoder().decode((await reader.read()).value);
    assert.ok(next.includes("heart"));
    assert.ok(next.includes("Mali"));
    controller.abort();
  } finally {
    controller.abort();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("output links cannot call operator tools and cross-origin requests are rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dobby-test-"));
  await writeFile(join(dir, "index.html"), "<html>output</html>");
  const core = new DobbyCore();
  const server = await startLocalServer(core, dir);
  try {
    assert.equal(
      (await fetch(`${server.origin}/api/status`, { method: "POST" })).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${server.origin}/api/status`, {
          method: "POST",
          headers: { Authorization: `Bearer ${server.outputToken}` },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${server.origin}/api/status`, {
          method: "POST",
          headers: {
            Origin: "https://other.example",
            Authorization: `Bearer ${server.operatorToken}`,
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(`${server.origin}/output?key=wrong`)).status,
      401,
    );
    assert.equal((await fetch(core.state.output.url)).status, 200);
    assert.equal(
      (
        await fetch(`${server.origin}/api/status`, {
          method: "POST",
          headers: { Authorization: "Bearer é".repeat(32) },
        })
      ).status,
      401,
    );
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("real MCP stdio client loads persona, plays action, claims and finishes an audience reply", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dobby-mcp-")),
    core = new DobbyCore();
  const server = await startLocalServer(core, dir),
    file = join(dir, "connection.json");
  await writeFile(
    file,
    JSON.stringify({ origin: server.origin, token: server.operatorToken }),
  );
  const client = new Client({ name: "dobby-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.env.DOBBY_TEST_EXECUTABLE || process.execPath,
    args: [
      process.env.DOBBY_TEST_SERVER || resolve("dist-electron/mcp.mjs"),
      "--connection-file",
      file,
    ],
    ...(process.env.DOBBY_TEST_EXECUTABLE
      ? {
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                (entry): entry is [string, string] =>
                  typeof entry[1] === "string",
              ),
            ),
            ELECTRON_RUN_AS_NODE: "1",
          },
        }
      : {}),
  });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 15);
    const persona = await client.callTool({
      name: "get_character",
      arguments: {},
    });
    assert.ok(JSON.stringify(persona).includes("Dobby"));
    await client.callTool({
      name: "perform_action",
      arguments: { action: "heart" },
    });
    assert.equal(core.state.action.name, "heart");
    core.simulate("comment");
    await client.callTool({ name: "claim_reply", arguments: {} });
    const job = core.state.queue[0];
    assert.equal(job.status, "claimed");
    await client.callTool({ name: "finish_reply", arguments: { id: job.id } });
    assert.equal(core.state.queue.length, 0);
    assert.ok(core.state.codex.lastSeen);
  } finally {
    await client.close();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
