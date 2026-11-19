import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SceneStore } from "../electron/scene";
import { DobbyCore } from "../electron/core";
import { startLocalServer } from "../electron/server";

test("scene resolution and background persist and imported images do not change the original", async () => {
  const folder = await mkdtemp(join(tmpdir(), "dobby-scene-"));
  try {
    const scenes = new SceneStore(folder);
    await scenes.load();
    const initial = scenes.state("http://127.0.0.1", "token");
    assert.equal(initial.width / initial.height, 9 / 16);
    await scenes.update({
      ...initial,
      width: 1920,
      height: 1080,
      background: "gradient",
      color: "#123456",
      color2: "#abcdef",
    });
    const restored = new SceneStore(folder);
    await restored.load();
    assert.equal(
      restored.state("http://127.0.0.1", "token").width /
        restored.state("http://127.0.0.1", "token").height,
      16 / 9,
    );
    assert.equal(restored.state("http://127.0.0.1", "token").color, "#123456");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6lUAAAAASUVORK5CYII=",
      "base64",
    );
    const source = join(folder, "original.png");
    await writeFile(source, png);
    await restored.importImage(source);
    assert.equal(
      restored.state("http://127.0.0.1", "token").background,
      "image",
    );
    assert.deepEqual((await restored.image()).bytes, png);
    assert.deepEqual(await readFile(source), png);
    const invalid = join(folder, "invalid.png");
    await writeFile(invalid, "<svg onload='invalid' />");
    await assert.rejects(() => restored.importImage(invalid));
    await assert.rejects(() => restored.update({ ...initial, width: 0 }));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("scene changes through the private API reach output state and reject invalid colors", async () => {
  const folder = await mkdtemp(join(tmpdir(), "dobby-scene-api-"));
  const scenes = new SceneStore(folder);
  await scenes.load();
  const core = new DobbyCore();
  const server = await startLocalServer(core, folder, undefined, scenes);
  try {
    const headers = {
      Authorization: `Bearer ${server.operatorToken}`,
      "Content-Type": "application/json",
    };
    const response = await fetch(`${server.origin}/api/set-scene`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        width: 1920,
        height: 1080,
        background: "solid",
        color: "#ff0000",
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(core.state.scene.width / core.state.scene.height, 16 / 9);
    assert.equal(core.state.scene.color, "#ff0000");
    const invalid = await fetch(`${server.origin}/api/set-scene`, {
      method: "POST",
      headers,
      body: JSON.stringify({ color: "url(https://untrusted.example)" }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(core.state.scene.color, "#ff0000");
  } finally {
    await server.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test("video imports persist without changing originals and stream authenticated byte ranges", async () => {
  const folder = await mkdtemp(join(tmpdir(), "dobby-video-"));
  const scenes = new SceneStore(folder);
  await scenes.load();
  const core = new DobbyCore();
  const server = await startLocalServer(core, folder, undefined, scenes);
  try {
    const initial = scenes.state(server.origin, server.outputToken);
    await assert.rejects(() =>
      scenes.update({ ...initial, background: "video" }),
    );
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypisom"),
      Buffer.alloc(4),
      Buffer.from("isommp42"),
      Buffer.from("test-video-bytes"),
    ]);
    const source = join(folder, "original.mp4");
    await writeFile(source, mp4);
    await scenes.importVideo(source);
    assert.deepEqual(await readFile(source), mp4);
    const restored = new SceneStore(folder);
    await restored.load();
    const state = restored.state(server.origin, server.outputToken);
    assert.equal(state.background, "video");
    assert.equal((await restored.video()).type, "video/mp4");
    assert.equal(
      state.videoUrl,
      restored.state(server.origin, server.outputToken).videoUrl,
    );
    const url = state.videoUrl!;
    const all = await fetch(url);
    assert.equal(all.status, 200);
    assert.equal(all.headers.get("content-type"), "video/mp4");
    assert.deepEqual(Buffer.from(await all.arrayBuffer()), mp4);
    const head = await fetch(url, { method: "HEAD" });
    assert.equal(head.headers.get("accept-ranges"), "bytes");
    assert.equal(Number(head.headers.get("content-length")), mp4.length);
    for (const [range, start, end] of [
      ["bytes=4-11", 4, 11],
      ["bytes=12-", 12, mp4.length - 1],
      ["bytes=-4", mp4.length - 4, mp4.length - 1],
      ["bytes=0-9999", 0, mp4.length - 1],
    ] as const) {
      const partial = await fetch(url, {
        headers: { Range: range, Origin: "file://" },
      });
      assert.equal(partial.status, 206);
      assert.equal(
        partial.headers.get("content-range"),
        `bytes ${start}-${end}/${mp4.length}`,
      );
      assert.deepEqual(
        Buffer.from(await partial.arrayBuffer()),
        mp4.subarray(start, end + 1),
      );
    }
    for (const range of [
      "bytes=999-",
      "bytes=5-2",
      "bytes=-0",
      "bytes=0-1,3-4",
      "bytes=-",
    ]) {
      const bad = await fetch(url, { headers: { Range: range } });
      assert.equal(bad.status, 416);
    }
    assert.equal(
      (await fetch(url.replace(server.outputToken, "invalid"))).status,
      401,
    );
    assert.equal(
      (await fetch(url, { headers: { Origin: "https://untrusted.example" } }))
        .status,
      403,
    );
    assert.equal((await fetch(url.replace("/video?", "/other?"))).status, 404);
    const invalid = join(folder, "fake.mp4");
    await writeFile(invalid, "<html>not video</html>");
    await assert.rejects(() => scenes.importVideo(invalid));
    await truncate(invalid, 501 * 1024 * 1024);
    await assert.rejects(() => scenes.importVideo(invalid));
    const webm = join(folder, "sample.webm");
    await writeFile(
      webm,
      Buffer.concat([
        Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
        Buffer.from("webm-test"),
      ]),
    );
    await scenes.importVideo(webm);
    assert.equal((await scenes.video()).type, "video/webm");
    await scenes.update({ ...initial, background: "solid" });
    await scenes.update({ ...initial, background: "video" });
  } finally {
    await server.close();
    await rm(folder, { recursive: true, force: true });
  }
});
