import WebSocket from "ws";
import { createHash } from "node:crypto";
import type { ViewerEvent } from "../src/shared";
import type { DobbyCore } from "./core";
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown, fallback = "") =>
  typeof v === "string" || typeof v === "number" ? String(v) : fallback;
const count = (v: unknown) => Math.max(1, Math.min(1_000_000, Number(v) || 1));

// The v3 names below come from the installed Euler SDK's generated schemas.
export function normalizeEuler(message: unknown): ViewerEvent | null {
  const envelope = obj(message),
    data = obj(envelope.data),
    user = obj(data.user),
    common = obj(data.common);
  let type: ViewerEvent["type"];
  switch (envelope.type) {
    case "WebcastChatMessage":
      type = "comment";
      break;
    case "WebcastGiftMessage":
      type = "gift";
      break;
    case "WebcastLikeMessage":
      type = "like";
      break;
    case "WebcastMemberMessage":
      type = "join";
      break;
    case "WebcastSocialMessage":
      if (str(data.action) !== "1") return null;
      type = "follow";
      break;
    default:
      return null;
  }
  const viewerId = str(user.id || user.displayId);
  if (!viewerId) return null;
  const gift = obj(data.gift);
  const text =
    type === "comment"
      ? str(data.content)
      : type === "gift"
        ? str(gift.name, "ของขวัญ")
        : type === "follow"
          ? "ติดตามช่องแล้ว"
          : type === "join"
            ? "เข้ามาร่วมไลฟ์"
            : "ส่งหัวใจ";
  const id =
    str(common.msgId) ||
    createHash("sha256").update(JSON.stringify(message)).digest("hex");
  return {
    id,
    viewerId,
    name: str(user.nickname || user.displayId, "ผู้ชม").slice(0, 80),
    type,
    text: text.slice(0, 2000),
    source: "euler",
    timestamp: Date.now(),
    count:
      type === "gift"
        ? count(data.repeatCount)
        : type === "like"
          ? count(data.count)
          : 1,
    ...(type === "gift"
      ? {
          giftId: str(data.giftId),
          streakId:
            str(data.groupId) !== "0"
              ? str(data.groupId) || undefined
              : undefined,
          streaking: Number(data.repeatEnd) === 0,
          // Field name varies by schema version; absent means value is unknown.
          ...(Number(gift.diamondCount ?? obj(data.giftDetails).diamondCount) > 0
            ? {
                diamonds: Math.min(
                  1_000_000,
                  Number(gift.diamondCount ?? obj(data.giftDetails).diamondCount),
                ),
              }
            : {}),
        }
      : {}),
  };
}
export class EulerConnector {
  private ws?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private attempt = 0;
  constructor(private core: DobbyCore) {}
  disconnect() {
    this.generation++;
    clearTimeout(this.retry);
    this.retry = undefined;
    this.ws?.terminate();
    this.ws = undefined;
    this.attempt = 0;
    this.core.state.euler.status = "disconnected";
    this.core.state.euler.message = "ยังไม่ได้เชื่อมต่อ";
    this.core.clearSession();
  }
  connect(key: string, username: string) {
    if (!key || !username)
      throw new Error("กรอกชื่อช่องและ Euler API key ก่อนเชื่อมต่อ");
    this.disconnect();
    const generation = this.generation;
    const open = () => {
      if (generation !== this.generation) return;
      this.core.state.euler.status = this.attempt
        ? "reconnecting"
        : "connecting";
      this.core.state.euler.message = this.attempt
        ? "กำลังเชื่อมต่อใหม่…"
        : "กำลังเชื่อมต่อช่อง…";
      this.core.publish();
      const url = new URL("wss://ws.eulerstream.com");
      url.search = new URLSearchParams({
        apiKey: key,
        uniqueId: username,
        "features.schemaVersion": "v3",
        "features.bundleEvents": "true",
        "features.rawMessages": "false",
      }).toString();
      const ws = new WebSocket(url, {
        handshakeTimeout: 15_000,
        maxPayload: 4 * 1024 * 1024,
      });
      this.ws = ws;
      ws.on("message", (raw) => {
        if (generation !== this.generation) return;
        try {
          const parsed: unknown = JSON.parse(raw.toString());
          const items = Array.isArray(obj(parsed).messages)
            ? (obj(parsed).messages as unknown[])
            : [parsed];
          for (const item of items) {
            const env = obj(item),
              payload = obj(env.data);
            if (
              env.type === "roomInfo" ||
              env.type === "tiktok.connect" ||
              (env.type === "room.status" && payload.state === "connected")
            ) {
              this.attempt = 0;
              this.core.state.euler.status = "connected";
              this.core.state.euler.message = `รับเหตุการณ์จาก @${username}`;
              this.core.publish();
            }
            if (
              env.type === "room.status" &&
              ["offline", "ended"].includes(str(payload.state))
            ) {
              this.disconnect();
              this.core.state.euler.message = "ช่องยังไม่ LIVE หรือจบ LIVE แล้ว";
              this.core.publish();
              return;
            }
            const event = normalizeEuler(item);
            if (event) this.core.ingest(event);
          }
        } catch {
          this.core.state.euler.message = "ได้รับข้อมูลที่อ่านไม่ได้ กำลังรอเหตุการณ์ถัดไป";
          this.core.publish();
        }
      });
      ws.on("error", () => {
        if (generation === this.generation) {
          this.core.state.euler.message =
            "เชื่อมต่อไม่สำเร็จ ตรวจเครือข่ายหรือ API key";
          this.core.publish();
        }
      });
      ws.on("close", (code) => {
        if (generation !== this.generation) return;
        if ([1000, 4005, 4400, 4401, 4403, 4404].includes(code)) {
          this.core.state.euler.status = [4400, 4401, 4403].includes(code)
            ? "error"
            : "disconnected";
          this.core.state.euler.message =
            code === 4401
              ? "API key ไม่ถูกต้อง"
              : code === 4403
                ? "API key ไม่มีสิทธิ์เข้าถึงช่องนี้"
                : code === 4404
                  ? "ช่องนี้ยังไม่ได้เริ่ม LIVE"
                  : code === 4400
                    ? "ตรวจชื่อช่องและการตั้งค่า"
                    : "การเชื่อมต่อสิ้นสุดแล้ว";
          this.core.clearSession();
          return;
        }
        this.attempt++;
        this.core.state.euler.status = "reconnecting";
        this.core.state.euler.message = `รอเชื่อมต่อใหม่ (รหัส ${code})`;
        this.core.publish();
        const delay =
          Math.min(
            60_000,
            (code === 4429 ? 15_000 : 1500) * 2 ** Math.min(this.attempt, 5),
          ) +
          Math.random() * 1000;
        this.retry = setTimeout(open, delay);
      });
    };
    open();
  }
}
