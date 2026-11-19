import {
  readFile,
  writeFile,
  readdir,
  stat,
  realpath,
  mkdir,
  rename,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { createHash } from "node:crypto";
import type {
  AvatarState,
  Live2DModelInfo,
  ModelSettings,
  ModelPlayback,
  ActionName,
  EmotionName,
} from "../src/shared";
import { modelSettingsSchema } from "./validation";

type ObjectData = Record<string, unknown>;
const object = (value: unknown): ObjectData =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectData)
    : {};
export const defaultModelSettings: ModelSettings = {
  scale: 1,
  x: 0,
  y: 0,
  mirror: false,
  mouthParameter: "ParamMouthOpenY",
};
interface ModelRecord {
  info: Live2DModelInfo;
  root: string;
  manifest: ObjectData;
  assets: string[];
}
const permitted = new Set([
  ".json",
  ".moc3",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".wav",
  ".mp3",
  ".ogg",
]);

export async function resolveModelAsset(root: string, path: string) {
  if (
    !path ||
    path.includes("\\") ||
    path.includes("\0") ||
    /^[a-z]+:/i.test(path) ||
    path.startsWith("/") ||
    !permitted.has(extname(path).toLowerCase())
  )
    throw new Error("โมเดลมีพาธไฟล์ที่ไม่รองรับ");
  const actual = await realpath(resolve(root, path));
  const actualRoot = await realpath(root);
  if (!actual.startsWith(actualRoot + sep))
    throw new Error("ไฟล์อ้างอิงออกนอกโฟลเดอร์โมเดล");
  const details = await stat(actual);
  if (!details.isFile() || details.size > 256 * 1024 * 1024)
    throw new Error("ไฟล์โมเดลมีขนาดใหญ่เกินไป");
  return actual;
}

export class ModelLibrary {
  private records: ModelRecord[] = [];
  private selectedId: string | null = null;
  private runtimePath: string | null = null;
  private writing = Promise.resolve();
  constructor(private folder: string) {}
  async load() {
    await mkdir(this.folder, { recursive: true });
    try {
      const value = JSON.parse(
        await readFile(join(this.folder, "live2d-library.json"), "utf8"),
      );
      if (Array.isArray(value.records))
        this.records = value.records
          .filter(
            (v: ModelRecord) =>
              v?.info?.id &&
              typeof v.root === "string" &&
              v.manifest &&
              Array.isArray(v.assets),
          )
          .slice(0, 50);
      for (const record of this.records) record.info.emotions ??= {};
      this.selectedId = this.records.some((r) => r.info.id === value.selectedId)
        ? value.selectedId
        : null;
      this.runtimePath =
        typeof value.runtimePath === "string" ? value.runtimePath : null;
    } catch {
      /* First launch has no imported models. */
    }
    if (
      this.runtimePath &&
      !this.runtimePath.startsWith(join(this.folder, "live2d-runtime") + sep)
    ) {
      await this.importCore(this.runtimePath).catch(() => {});
    }
  }
  private save() {
    const content = JSON.stringify({
      records: this.records,
      selectedId: this.selectedId,
      runtimePath: this.runtimePath,
    });
    const path = join(this.folder, "live2d-library.json");
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        await writeFile(path + ".tmp", content, { mode: 0o600 });
        await rename(path + ".tmp", path);
      });
    return this.writing;
  }
  async importCore(path: string) {
    const file = await realpath(path),
      details = await stat(file);
    if (!details.isFile() || details.size > 5 * 1024 * 1024)
      throw new Error("เลือกไฟล์ live2dcubismcore.min.js จาก Cubism SDK");
    const text = await readFile(file, "utf8");
    if (!text.includes("Live2DCubismCore") || !text.includes("Live2D"))
      throw new Error("ไฟล์นี้ไม่ใช่ Cubism Core");
    const runtimeFolder = join(this.folder, "live2d-runtime");
    await mkdir(runtimeFolder, { recursive: true });
    const localRuntime = join(runtimeFolder, "live2dcubismcore.min.js");
    await writeFile(localRuntime + ".tmp", text, { mode: 0o600 });
    await rename(localRuntime + ".tmp", localRuntime);
    this.runtimePath = localRuntime;
    await this.save();
  }
  async importPath(path: string) {
    const details = await stat(path),
      candidates: string[] = [];
    const scan = async (folder: string, depth: number) => {
      if (depth > 5 || candidates.length >= 50) return;
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        if (entry.isDirectory())
          await scan(join(folder, entry.name), depth + 1);
        else if (entry.name.endsWith(".model3.json") && candidates.length < 50)
          candidates.push(join(folder, entry.name));
      }
    };
    if (details.isFile() && path.endsWith(".model3.json"))
      candidates.push(path);
    else if (details.isDirectory()) await scan(path, 0);
    const errors: string[] = [];
    let imported = 0;
    for (const file of candidates) {
      try {
        await this.importManifest(file);
        imported++;
      } catch (error) {
        errors.push(
          `${basename(file)}: ${error instanceof Error ? error.message : "อ่านโมเดลไม่สำเร็จ"}`,
        );
      }
    }
    if (!candidates.length) errors.push("ไม่พบไฟล์ .model3.json ในโฟลเดอร์นี้");
    await this.save();
    return { imported, errors };
  }
  private async importManifest(path: string) {
    const root = await realpath(dirname(path)),
      file = basename(path);
    const manifestPath = await resolveModelAsset(root, file);
    if ((await stat(manifestPath)).size > 2 * 1024 * 1024)
      throw new Error("model3.json ใหญ่เกินไป");
    const manifest = object(JSON.parse(await readFile(manifestPath, "utf8"))),
      refs = object(manifest.FileReferences);
    if (
      manifest.Version !== 3 ||
      typeof refs.Moc !== "string" ||
      !Array.isArray(refs.Textures) ||
      !refs.Textures.length
    )
      throw new Error("ต้องเป็นชุดโมเดล Cubism .model3.json ที่มี Moc และ Textures");
    const assets = new Set<string>();
    const add = (value: unknown) => {
      if (typeof value === "string" && value) assets.add(value);
    };
    add(refs.Moc);
    refs.Textures.forEach(add);
    add(refs.Physics);
    add(refs.Pose);
    add(refs.UserData);
    add(refs.DisplayInfo);
    const motionEntries = object(refs.Motions),
      motions: Live2DModelInfo["motions"] = [];
    for (const [group, entries] of Object.entries(motionEntries)) {
      if (!Array.isArray(entries)) throw new Error("Motions ไม่ถูกต้อง");
      entries.forEach((entry, index) => {
        const value = object(entry);
        add(value.File);
        add(value.Sound);
        motions.push({
          group,
          index,
          label: `${group || "Motion"} · ${index + 1}`,
        });
      });
    }
    const expressions: string[] = [];
    if (Array.isArray(refs.Expressions))
      for (const entry of refs.Expressions) {
        const value = object(entry);
        add(value.File);
        if (typeof value.Name === "string") expressions.push(value.Name);
      }
    if (assets.size > 1000) throw new Error("ไฟล์ประกอบมากเกินไป");
    for (const ref of assets) await resolveModelAsset(root, ref);
    const moc = await readFile(await resolveModelAsset(root, refs.Moc));
    if (moc.subarray(0, 4).toString() !== "MOC3")
      throw new Error("ไฟล์ .moc3 ไม่ถูกต้อง");
    const id = createHash("sha256")
      .update(join(root, file))
      .digest("hex")
      .slice(0, 20);
    const previous = this.records.find((r) => r.info.id === id);
    const info: Live2DModelInfo = {
      id,
      name: file.replace(/\.model3\.json$/, ""),
      file,
      motions,
      expressions,
      settings: previous?.info.settings ?? { ...defaultModelSettings },
      mappings: previous?.info.mappings ?? {},
      emotions: previous?.info.emotions ?? {},
    };
    this.records = [
      ...this.records.filter((r) => r.info.id !== id),
      { info, root, manifest, assets: [...assets] },
    ].slice(-50);
    if (!this.selectedId) this.selectedId = id;
  }
  async select(id: string | null) {
    if (id && !this.records.some((r) => r.info.id === id))
      throw new Error("ไม่พบโมเดลนี้");
    this.selectedId = id;
    await this.save();
  }
  selected() {
    return this.records.find((r) => r.info.id === this.selectedId);
  }
  async settings(value: ModelSettings) {
    const record = this.selected();
    if (!record) throw new Error("เลือกโมเดลก่อน");
    record.info.settings = modelSettingsSchema.parse(value);
    await this.save();
  }
  validatePlayback(selection: ModelPlayback) {
    const record = this.selected();
    if (!record) throw new Error("เลือกโมเดลก่อน");
    const valid =
      selection.kind === "expression"
        ? record.info.expressions.includes(selection.name)
        : record.info.motions.some(
            (m) =>
              m.group === selection.name && m.index === (selection.index ?? 0),
          );
    if (!valid) throw new Error("โมเดลนี้ไม่มีสีหน้าหรือท่าทางที่เลือก");
  }
  async map(action: ActionName, selection: ModelPlayback | null) {
    const record = this.selected();
    if (!record) throw new Error("เลือกโมเดลก่อน");
    if (selection) {
      this.validatePlayback(selection);
      record.info.mappings[action] = selection;
    } else delete record.info.mappings[action];
    await this.save();
  }
  async mapEmotion(emotion: EmotionName, selection: ModelPlayback | null) {
    const record = this.selected();
    if (!record) throw new Error("เลือกโมเดลก่อน");
    const emotions = (record.info.emotions ??= {});
    if (selection) {
      this.validatePlayback(selection);
      emotions[emotion] = selection;
    } else delete emotions[emotion];
    await this.save();
  }
  state(origin: string, token: string): AvatarState {
    const selected = this.selected();
    return {
      models: this.records.map((r) => structuredClone(r.info)),
      selectedId: this.selectedId,
      modelUrl: selected
        ? `${origin}/models/${token}/${selected.info.id}/${encodeURIComponent(selected.info.file)}`
        : null,
      coreUrl: this.runtimePath
        ? `${origin}/runtime/${token}/live2dcubismcore.min.js`
        : null,
      status: selected ? "loading" : "demo",
      error: "",
      playback: null,
    };
  }
  async asset(modelId: string, resource: string) {
    const record = this.records.find((r) => r.info.id === modelId);
    if (!record) throw new Error("Unknown model");
    if (resource === record.info.file)
      return {
        buffer: Buffer.from(JSON.stringify(record.manifest)),
        extension: ".json",
      };
    if (!record.assets.includes(resource)) throw new Error("Unlisted asset");
    const path = await resolveModelAsset(record.root, resource);
    return {
      buffer: await readFile(path),
      extension: extname(path).toLowerCase(),
    };
  }
  async runtime() {
    if (!this.runtimePath) throw new Error("No Cubism Core");
    return readFile(this.runtimePath);
  }
}
