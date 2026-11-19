import { EventEmitter } from "node:events";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { hostInstructions, hostContextSchema, audienceSchema } from "./host-context";
import { CodexRpc, findCodex } from "./codex-rpc";
import { emotionSchema } from "./validation";
import { DEFAULT_BRAIN, type BrainState, type Character, type EmotionName, type HostContext } from "../src/shared";

const modelId = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9._:/-]+$/);
const replySchema = z.object({
  reply: z.string().trim().min(1).max(1000),
  emotion: emotionSchema.optional().catch(undefined),
});
export type AudienceInput = z.input<typeof audienceSchema>;

/** A selected Codex text model writes the answer; the voice session only reads it. */
export class DobbyBrain extends EventEmitter {
  state: BrainState = structuredClone(DEFAULT_BRAIN);
  private preparing: Promise<void> | null = null;
  private catalogRpc: CodexRpc | null = null;
  private activeRpc: CodexRpc | null = null;
  /** Kept between replies so each comment does not pay for a new Codex process. */
  private warm: { rpc: CodexRpc; overrides: Record<string, unknown>; uses: number } | null = null;
  private cancelPending: ((error: Error) => void) | null = null;
  private generation = 0;
  private disposed = false;
  /** Mood the model chose for its latest reply; undefined if it gave none. */
  lastEmotion: EmotionName | undefined;
  constructor(
    private folder: string,
    private factory = () => new CodexRpc(),
    private locate = findCodex,
  ) {
    super();
  }
  private publish() {
    this.emit("change", this.state);
  }
  async load() {
    try {
      const saved = JSON.parse(
        await readFile(join(this.folder, "brain-settings.json"), "utf8"),
      );
      this.state.selectedId = modelId.nullable().parse(saved.model);
      if (this.state.selectedId)
        this.state.message = `โมเดลที่บันทึกไว้: ${this.state.selectedId}`;
    } catch {
      /* First launch keeps the existing realtime host. */
    }
  }
  async prepare() {
    if (this.disposed) throw new Error("ปิดโมเดล AI แล้ว");
    if (this.preparing) return this.preparing;
    if (this.state.status === "thinking")
      throw new Error("รอให้คิดคำตอบจบก่อนโหลดโมเดลใหม่");
    this.preparing = this.discover().finally(() => {
      this.preparing = null;
    });
    return this.preparing;
  }
  private async discover() {
    const rpc = this.factory();
    this.catalogRpc = rpc;
    this.state.status = "loading";
    this.state.message = "กำลังโหลดโมเดลจาก Codex ที่ล็อกอินอยู่…";
    this.publish();
    try {
      const executable = await this.locate();
      if (this.disposed) throw new Error("ยกเลิกแล้ว");
      await rpc.start(executable, true);
      const account = await rpc.call("account/read", { refreshToken: false });
      if (account.account?.type !== "chatgpt")
        throw new Error("ใช้ codex login ด้วยบัญชี ChatGPT ก่อน · ไม่ใช้ API key");
      const models: BrainState["models"] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const result = await rpc.call("model/list", {
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        if (!Array.isArray(result.data))
          throw new Error("อ่านรายชื่อโมเดลจาก Codex ไม่ได้");
        for (const raw of result.data) {
          const id = modelId.safeParse(raw.model);
          if (!id.success || raw.hidden || models.some((m) => m.id === id.data))
            continue;
          const efforts = Array.isArray(raw.supportedReasoningEfforts)
            ? raw.supportedReasoningEfforts
            : [];
          const effort =
            efforts.find((e: any) => e.reasoningEffort === "low")
              ?.reasoningEffort ??
            efforts.find((e: any) =>
              ["none", "minimal", "medium", "high"].includes(e.reasoningEffort),
            )?.reasoningEffort ??
            null;
          models.push({
            id: id.data,
            name: String(raw.displayName || id.data).slice(0, 100),
            description: String(raw.description || "").slice(0, 400),
            default: raw.isDefault === true,
            effort,
          });
        }
        cursor =
          typeof result.nextCursor === "string" ? result.nextCursor : null;
        if (!cursor) break;
        if (page === 19)
          throw new Error("รายชื่อโมเดลมีหลายหน้ามากเกินไป · ลองโหลดใหม่");
      }
      if (!models.length) throw new Error("บัญชีนี้ยังไม่มีโมเดลที่เลือกได้");
      this.state.models = models;
      const missing =
        this.state.selectedId &&
        !models.some((m) => m.id === this.state.selectedId);
      this.state.status = missing ? "error" : "ready";
      this.state.message = missing
        ? "โมเดลที่บันทึกไว้ใช้ไม่ได้แล้ว · กรุณาเลือกใหม่"
        : `โหลดแล้ว ${models.length} โมเดล · เลือกโมเดลสำหรับคิดคำตอบได้`;
      this.publish();
    } catch (e) {
      if (!this.disposed) {
        this.state.status = "error";
        this.state.message =
          e instanceof Error ? e.message : "โหลดโมเดลไม่สำเร็จ";
        this.publish();
      }
      throw e;
    } finally {
      if (this.catalogRpc === rpc) this.catalogRpc = null;
      rpc.close();
    }
  }
  async select(raw: string | null) {
    if (this.state.status === "thinking" || this.preparing)
      throw new Error("รอให้โมเดลทำงานจบก่อน");
    const id = modelId.nullable().parse(raw);
    this.release();
    if (id && !this.state.models.some((m) => m.id === id))
      throw new Error("โหลดรายชื่อและเลือกโมเดลที่ Codex ใช้ได้ก่อน");
    await mkdir(this.folder, { recursive: true });
    const file = join(this.folder, "brain-settings.json");
    await writeFile(file + ".tmp", JSON.stringify({ model: id }), {
      mode: 0o600,
    });
    await rename(file + ".tmp", file);
    this.state.selectedId = id;
    this.state.activeModel = null;
    this.state.status = "ready";
    this.state.message = id ? `บันทึกโมเดลคิดคำตอบ: ${id}` : DEFAULT_BRAIN.message;
    this.publish();
  }
  async respond(character: Character, event: AudienceInput, context?: HostContext): Promise<string> {
    if (this.activeRpc) throw new Error("กำลังคิดคำตอบอยู่");
    const generation = this.generation;
    if (!this.state.models.length) await this.prepare();
    if (generation !== this.generation || this.disposed)
      throw new Error("ยกเลิกการคิดคำตอบแล้ว");
    const selected = this.state.models.find(
      (m) => m.id === this.state.selectedId,
    );
    if (!selected)
      throw new Error("โมเดลที่เลือกใช้ไม่ได้ · โหลดรายชื่อโมเดลและเลือกใหม่");
    const input = audienceSchema.parse(event);
    let warm = this.warm;
    this.lastEmotion = undefined;
    const rpc = warm?.rpc ?? this.factory();
    this.activeRpc = rpc;
    this.state.status = "thinking";
    this.state.message = `${selected.name} กำลังคิดคำตอบ…`;
    this.publish();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let succeeded = false;
    let onDisconnected: (() => void) | undefined;
    let onNotification: ((method: string, params: any) => void) | undefined;
    try {
      const cwd = join(this.folder, "brain-sandbox");
      if (!warm) {
        const executable = await this.locate();
        if (generation !== this.generation) throw new Error("ยกเลิกการคิดคำตอบแล้ว");
        await rpc.start(executable, true);
        if (generation !== this.generation) throw new Error("ยกเลิกการคิดคำตอบแล้ว");
        await mkdir(cwd, { recursive: true });
        // Disable configured MCP servers for this private text-only thread.
        const config = await rpc.call("config/read", { includeLayers: false });
        const overrides: Record<string, unknown> = {};
        for (const name of Object.keys(config.config?.mcp_servers ?? {}))
          overrides[`mcp_servers.${name}.enabled`] = false;
        warm = { rpc, overrides, uses: 0 };
        this.warm = warm;
        // A process that exits while idle must not be handed to the next reply.
        rpc.on("disconnected", () => {
          if (this.warm?.rpc === rpc) this.warm = null;
        });
      }
      warm.uses++;
      const overrides = warm.overrides;
      const thread = await rpc.call("thread/start", {
        model: selected.id,
        allowProviderModelFallback: false,
        ephemeral: true,
        cwd,
        environments: [],
        dynamicTools: [],
        selectedCapabilityRoots: [],
        sandbox: "read-only",
        approvalPolicy: "untrusted",
        config: overrides,
        baseInstructions: hostInstructions(character) + " Return only JSON matching the requested schema with the exact speakable reply and the facial emotion that fits how you deliver it. No commentary or reasoning.",
      });
      if (generation !== this.generation) throw new Error("ยกเลิกการคิดคำตอบแล้ว");
      if (thread.model !== selected.id)
        throw new Error("Codex ไม่ได้ใช้โมเดลที่เลือก · หยุดเพื่อให้เลือกใหม่");
      this.state.activeModel = thread.model;
      const threadId = thread.thread.id;
      let finalText = "";
      const answer = new Promise<string>((resolve, reject) => {
        this.cancelPending = reject;
        timer = setTimeout(
          () => reject(new Error("โมเดลคิดคำตอบเกิน 45 วินาที · ลองเลือกโมเดลอื่น")),
          45_000,
        );
        onDisconnected = () =>
          reject(new Error("Codex ตัดการเชื่อมต่อระหว่างคิดคำตอบ"));
        rpc.on("disconnected", onDisconnected);
        onNotification = (method: string, params: any) => {
          if (generation !== this.generation || params?.threadId !== threadId)
            return;
          if (
            method === "item/started" &&
            !["userMessage", "agentMessage", "reasoning"].includes(
              params.item?.type,
            )
          ) {
            reject(new Error("โมเดลขอทำงานนอกการตอบข้อความ · หยุดคำตอบนี้แล้ว"));
            rpc.close();
          }
          if (
            method === "item/completed" &&
            params.item?.type === "agentMessage" &&
            params.item.phase !== "commentary"
          )
            finalText = params.item.text;
          if (method === "turn/completed") {
            if (params.turn?.status !== "completed")
              reject(
                new Error(
                  params.turn?.error?.message || "โมเดลสร้างคำตอบไม่สำเร็จ",
                ),
              );
            else {
              try {
                const parsed = replySchema.parse(JSON.parse(finalText));
                this.lastEmotion = parsed.emotion;
                resolve(parsed.reply);
              } catch {
                reject(
                  new Error("รูปแบบคำตอบจากโมเดลไม่ถูกต้อง · ไม่ส่งข้อความนี้ไปพูด"),
                );
              }
            }
          }
        };
        rpc.on("notification", onNotification);
      });
      answer.catch(() => {});
      await rpc.call("turn/start", {
        threadId,
        model: selected.id,
        ...(selected.effort ? { effort: selected.effort } : {}),
        environments: [],
        input: [
          {
            type: "text",
            text: JSON.stringify({ audienceEvent: input, ...(context ? { hostContext: hostContextSchema.parse(context) } : {}) }),
            text_elements: [],
          },
        ],
        outputSchema: {
          type: "object",
          properties: {
            reply: { type: "string", minLength: 1, maxLength: 1000 },
            emotion: {
              type: "string",
              enum: ["neutral", "happy", "excited", "love", "surprised", "sad", "thinking", "shy", "angry"],
            },
          },
          required: ["reply", "emotion"],
          additionalProperties: false,
        },
      });
      const reply = await answer;
      if (generation !== this.generation) throw new Error("ยกเลิกการคิดคำตอบแล้ว");
      this.state.status = "ready";
      this.state.message = `${selected.name} คิดคำตอบแล้ว`;
      this.publish();
      succeeded = true;
      return reply;
    } catch (e) {
      if (generation === this.generation) {
        this.state.status = "error";
        this.state.message = e instanceof Error ? e.message : "คิดคำตอบไม่สำเร็จ";
        this.publish();
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      if (onDisconnected) rpc.off("disconnected", onDisconnected);
      if (onNotification) rpc.off("notification", onNotification);
      if (this.activeRpc === rpc) {
        this.activeRpc = null;
        this.cancelPending = null;
      }
      // Reuse a healthy process; recycle after many threads or any failure.
      if (!succeeded || !warm || warm.uses >= 40 || this.warm !== warm) {
        if (this.warm?.rpc === rpc) this.warm = null;
        rpc.close();
      }
    }
  }
  /** Releases the warm Codex process (Auto Host stopped or model changed). */
  release() {
    const warm = this.warm;
    this.warm = null;
    if (warm && warm.rpc !== this.activeRpc) warm.rpc.close();
  }
  cancel() {
    this.generation++;
    this.cancelPending?.(new Error("ยกเลิกการคิดคำตอบแล้ว"));
    this.cancelPending = null;
    this.activeRpc?.close();
    this.activeRpc = null;
    this.release();
    if (this.state.status === "thinking") {
      this.state.status = "ready";
      this.state.message = "หยุดคิดคำตอบแล้ว";
      this.publish();
    }
  }
  dispose() {
    this.disposed = true;
    this.cancel();
    this.catalogRpc?.close();
  }
}
