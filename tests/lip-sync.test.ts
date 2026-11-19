import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMouthParameters, mouthParameterValue } from "../src/lip-sync";

test("Mao's invalid saved mouth P falls back to the model's real ParamA instead of writing a phantom parameter", () => {
  const available = ["ParamAngleX", "ParamA", "ParamI", "ParamU", "ParamE", "ParamO"];
  assert.deepEqual(resolveMouthParameters("P", available, ["ParamA"]), ["ParamA"]);
  assert.deepEqual(resolveMouthParameters("ParamO", available, ["ParamA"]), ["ParamO"]);
  assert.deepEqual(resolveMouthParameters("P", available, ["not-real"]), ["ParamA"]);
  assert.deepEqual(resolveMouthParameters("P", ["ParamAngleX"], []), []);
});

test("mouth signal maps to the actual rig range and closes at silence", () => {
  assert.equal(mouthParameterValue(1, 0, 2), 2);
  assert.equal(mouthParameterValue(0, -1, 1), 0);
  assert.equal(mouthParameterValue(0.5, 0, 1), 0.5);
  assert.equal(mouthParameterValue(10, 0, 1), 1);
});
