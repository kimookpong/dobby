import {
  readFile,
  writeFile,
  rename,
  mkdir,
  stat,
  open,
  copyFile,
  chmod,
} from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_SCENE, type SceneSettings } from "../src/shared";
import { sceneSchema } from "./validation";
export class SceneStore {
  private settings = { ...DEFAULT_SCENE };
  private imageFile: string | null = null;
  private videoFile: string | null = null;
  private revision = Date.now();
  private writing = Promise.resolve();
  constructor(private folder: string) {}
  async load() {
    await mkdir(this.folder, { recursive: true });
    try {
      const raw = JSON.parse(
        await readFile(join(this.folder, "scene.json"), "utf8"),
      );
      this.settings = {
        ...sceneSchema.parse(raw.settings),
        imageUrl: null,
        videoUrl: null,
      };
      this.imageFile =
        typeof raw.imageFile === "string" &&
        /^scene-background\.(png|jpg|webp)$/.test(raw.imageFile)
          ? raw.imageFile
          : null;
      this.videoFile =
        typeof raw.videoFile === "string" &&
        /^scene-background\.(mp4|webm)$/.test(raw.videoFile)
          ? raw.videoFile
          : null;
    } catch {
      /* Use default scene. */
    }
  }
  private save() {
    const value = JSON.stringify({
      settings: this.settings,
      imageFile: this.imageFile,
      videoFile: this.videoFile,
    });
    const file = join(this.folder, "scene.json");
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        await writeFile(file + ".tmp", value, { mode: 0o600 });
        await rename(file + ".tmp", file);
      });
    return this.writing;
  }
  async update(settings: Omit<SceneSettings, "imageUrl" | "videoUrl">) {
    const parsed = sceneSchema.parse(settings);
    if (parsed.background === "image" && !this.imageFile)
      throw new Error("นำเข้ารูปพื้นหลังก่อน");
    if (parsed.background === "video" && !this.videoFile)
      throw new Error("นำเข้าวิดีโอพื้นหลังก่อน");
    this.settings = { ...parsed, imageUrl: null, videoUrl: null };
    await this.save();
  }
  async importImage(file: string) {
    if ((await stat(file)).size > 20 * 1024 * 1024)
      throw new Error("เลือกภาพขนาดไม่เกิน 20 MB");
    const bytes = await readFile(file);
    const extension = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? "png"
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? "jpg"
        : bytes.subarray(0, 4).toString() === "RIFF" &&
            bytes.subarray(8, 12).toString() === "WEBP"
          ? "webp"
          : null;
    if (!extension) throw new Error("เลือกภาพ PNG, JPG หรือ WebP");
    const name = `scene-background.${extension}`,
      path = join(this.folder, name);
    await writeFile(path + ".tmp", bytes, { mode: 0o600 });
    await rename(path + ".tmp", path);
    this.imageFile = name;
    this.revision = Date.now();
    this.settings.background = "image";
    await this.save();
  }
  async importVideo(file: string) {
    const source = await open(file, "r");
    let extension: "mp4" | "webm";
    try {
      const info = await source.stat();
      if (!info.isFile() || info.size > 500 * 1024 * 1024)
        throw new Error("เลือกวิดีโอขนาดไม่เกิน 500 MB");
      const header = Buffer.alloc(4096);
      const { bytesRead } = await source.read(header, 0, header.length, 0);
      const bytes = header.subarray(0, bytesRead);
      if (
        bytes.length >= 16 &&
        bytes.subarray(4, 8).toString() === "ftyp" &&
        /^(isom|iso[2-9]|mp4[12]|avc1|M4V )$/.test(
          bytes.subarray(8, 12).toString(),
        )
      )
        extension = "mp4";
      else if (
        bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) &&
        bytes.includes(Buffer.from("webm"))
      )
        extension = "webm";
      else throw new Error("เลือกวิดีโอ MP4 หรือ WebM");
    } finally {
      await source.close();
    }
    const name = `scene-background.${extension}`,
      path = join(this.folder, name);
    await copyFile(file, path + ".tmp");
    await chmod(path + ".tmp", 0o600);
    await rename(path + ".tmp", path);
    this.videoFile = name;
    this.revision = Date.now();
    this.settings.background = "video";
    await this.save();
  }
  async video() {
    if (!this.videoFile) throw new Error("No background video");
    const path = join(this.folder, this.videoFile);
    return {
      path,
      size: (await stat(path)).size,
      type: this.videoFile.endsWith("webm") ? "video/webm" : "video/mp4",
    };
  }
  state(origin: string, token: string): SceneSettings {
    return {
      ...this.settings,
      imageUrl: this.imageFile
        ? `${origin}/background/${token}/image?v=${this.revision}`
        : null,
      videoUrl: this.videoFile
        ? `${origin}/background/${token}/video?v=${this.revision}`
        : null,
    };
  }
  async image() {
    if (!this.imageFile) throw new Error("No background image");
    return {
      bytes: await readFile(join(this.folder, this.imageFile)),
      type: this.imageFile.endsWith("png")
        ? "image/png"
        : this.imageFile.endsWith("webp")
          ? "image/webp"
          : "image/jpeg",
    };
  }
}
