import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { DobbyCore } from "../electron/core";
import { AutoHost } from "../electron/auto-host";
import type { DobbyVoice } from "../electron/voice";
import type { DobbyBrain } from "../electron/brain";
import type { EmotionName } from "../src/shared";
import { detectEmotion, guessEmotionMappings } from "../src/emotion";

const settle = () => new Promise<void>((r) => setImmediate(r));

test("emotion detector reads clear Thai cues and stays neutral otherwise", () => {
  assert.equal(detectEmotion("ว้าว สุดยอดไปเลย!!").emotion, "excited");
  assert.equal(detectEmotion("เสียใจด้วยนะคะ").emotion, "sad");
  assert.equal(detectEmotion("แหะๆ เขินเลย ชมเกินไปแล้ว").emotion, "shy");
  assert.equal(detectEmotion("วันนี้อากาศเป็นอย่างไร").emotion, "neutral");
  // A plain thank-you for a gift still reads as warm.
  assert.equal(detectEmotion("ขอบคุณค่ะ", "gift").emotion, "love");
});

test("expression names suggest mappings only where the name is meaningful", () => {
  assert.deepEqual(guessEmotionMappings(["exp_smile", "Sad01", "angry", "F01"]), {
    happy: "exp_smile",
    sad: "Sad01",
    angry: "angry",
  });
  assert.deepEqual(guessEmotionMappings(["F01", "F02"]), {});
});

class HostVoice extends EventEmitter {
  state = { status: "connected", mode: "host", preview: false, speaking: false };
  async respondAudience() {
    this.state.speaking = true;
    this.emit("change");
  }
  async speak() {
    this.state.speaking = true;
    this.emit("change");
  }
  keepAlive() {}
  disconnect() {}
  finish() {
    this.state.speaking = false;
    this.emit("change");
    this.emit("utteranceFinished");
  }
}

test("Codex Voice transcripts set a mood a limited number of times and return to neutral", async () => {
  const core = new DobbyCore();
  core.state.euler.status = "connected";
  const voice = new HostVoice();
  const host = new AutoHost(core, voice as unknown as DobbyVoice);
  const moods: EmotionName[] = [];
  let lastAt = -1;
  core.on("change", () => {
    if (core.state.emotion.at !== lastAt) {
      lastAt = core.state.emotion.at;
      moods.push(core.state.emotion.name);
    }
  });
  try {
    host.start();
    core.simulate("comment");
    await settle();
    voice.emit("transcript", "สวัสดีค่ะ ดีใจที่มาคุยกันนะคะ");
    voice.emit("transcript", "ว้าว สุดยอดเลย!!");
    voice.emit("transcript", "เสียใจด้วยนะ ขอโทษจริงๆ");
    voice.emit("transcript", "โกรธแล้วนะ งอนแล้ว");
    assert.equal(core.state.emotion.name !== "neutral", true);
    // At most two mood switches per reply keeps the face from flickering.
    assert.ok(moods.filter((m) => m !== "neutral").length <= 2);
    voice.finish();
    await settle();
    assert.equal(core.state.emotion.name, "neutral");
  } finally {
    host.dispose();
  }
});

test("text-model emotion shows thinking first, then the model's chosen mood while speaking", async () => {
  const core = new DobbyCore();
  core.state.euler.status = "connected";
  const voice = new HostVoice();
  let resolve!: (text: string) => void;
  const brain = {
    state: { selectedId: "text-model" },
    lastEmotion: undefined as EmotionName | undefined,
    cancel() {},
    respond() {
      return new Promise<string>((done) => {
        resolve = done;
      });
    },
  };
  const host = new AutoHost(core, voice as unknown as DobbyVoice, brain as unknown as DobbyBrain);
  try {
    host.start();
    core.simulate("comment");
    await settle();
    assert.equal(core.state.emotion.name, "thinking");
    brain.lastEmotion = "shy";
    resolve("ขอบคุณที่ชมนะคะ");
    await settle();
    await settle();
    assert.equal(core.state.emotion.name, "shy");
    voice.finish();
    await settle();
    assert.equal(core.state.emotion.name, "neutral");
  } finally {
    host.dispose();
  }
});
