import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ModelLibrary, resolveModelAsset } from "../electron/models";

test("imported models retain separate transforms, switch persistently and leave source assets untouched", async () => {
  const folder = await mkdtemp(join(tmpdir(), "dobby-models-"));
  try {
    for (const name of ["Haru", "你好"]) {
      const root = join(folder, "source", name);
      await mkdir(root, { recursive: true });
      await writeFile(join(root, "model.moc3"), Buffer.from("MOC3-test"));
      await writeFile(join(root, "texture.png"), "original-texture");
      await writeFile(
        join(root, "smile.exp3.json"),
        JSON.stringify({ Type: "Live2D Expression", Parameters: [] }),
      );
      await writeFile(
        join(root, `${name}.model3.json`),
        JSON.stringify({
          Version: 3,
          FileReferences: {
            Moc: "model.moc3",
            Textures: ["texture.png"],
            Expressions: [{ Name: "Smile", File: "smile.exp3.json" }],
          },
        }),
      );
    }
    const library = new ModelLibrary(join(folder, "data"));
    await library.load();
    assert.equal(
      (await library.importPath(join(folder, "source"))).imported,
      2,
    );
    const state = library.state("http://127.0.0.1:1234", "read-token");
    const first = state.models[0],
      second = state.models[1];
    await library.select(first.id);
    await library.settings({ ...first.settings, scale: 1.8, x: 12 });
    await library.map("happy", { kind: "expression", name: "Smile" });
    await library.select(second.id);
    assert.equal(library.selected()!.info.settings.scale, 1);
    const restored = new ModelLibrary(join(folder, "data"));
    await restored.load();
    assert.equal(restored.selected()!.info.id, second.id);
    await restored.select(first.id);
    assert.equal(restored.selected()!.info.settings.scale, 1.8);
    assert.equal(restored.selected()!.info.mappings.happy?.name, "Smile");
    assert.throws(() =>
      restored.validatePlayback({ kind: "expression", name: "NotInModel" }),
    );
    const texture = await restored.asset(first.id, "texture.png");
    assert.equal(texture.buffer.toString(), "original-texture");
    await assert.rejects(() => restored.asset(first.id, "../secret.json"));
    assert.equal(
      await readFile(join(folder, "source", first.name, "texture.png"), "utf8"),
      "original-texture",
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("model asset resolver refuses remote references and symlinks outside the model folder", async () => {
  const folder = await mkdtemp(join(tmpdir(), "dobby-assets-"));
  try {
    const root = join(folder, "model");
    await mkdir(root);
    await writeFile(join(folder, "private.json"), "not-for-broadcast");
    await symlink(join(folder, "private.json"), join(root, "escape.json"));
    await assert.rejects(() => resolveModelAsset(root, "escape.json"));
    await assert.rejects(() => resolveModelAsset(root, "../private.json"));
    await assert.rejects(() =>
      resolveModelAsset(root, "https://example.com/model.json"),
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("imported textures are available to the Electron file origin but unlisted files remain private", async () => {
  const { DobbyCore } = await import("../electron/core");
  const { startLocalServer } = await import("../electron/server");
  const folder = await mkdtemp(join(tmpdir(), "dobby-texture-"));
  let server: Awaited<ReturnType<typeof startLocalServer>> | undefined;
  try {
    const root = join(folder, "source");
    await mkdir(root);
    await writeFile(join(root, "model.moc3"), "MOC3-test");
    await writeFile(join(root, "texture.png"), "texture-body");
    await writeFile(join(root, "private.json"), "do-not-share");
    await writeFile(
      join(root, "test.model3.json"),
      JSON.stringify({
        Version: 3,
        FileReferences: { Moc: "model.moc3", Textures: ["texture.png"] },
      }),
    );
    const library = new ModelLibrary(join(folder, "data"));
    await library.load();
    await library.importPath(root);
    const core = new DobbyCore();
    server = await startLocalServer(core, folder, library);
    const model = library.state(server.origin, server.outputToken).models[0];
    const url = `${server.origin}/models/${server.outputToken}/${model.id}`;
    const response = await fetch(`${url}/texture.png`, {
      headers: { Origin: "file://" },
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "texture-body");
    assert.notEqual((await fetch(`${url}/private.json`)).status, 200);
    assert.equal(
      (
        await fetch(`${url}/texture.png`, {
          headers: { Origin: "https://unrelated.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(`${server.origin}/models/wrong/${model.id}/texture.png`))
        .status,
      401,
    );
  } finally {
    await server?.close();
    await rm(folder, { recursive: true, force: true });
  }
});
