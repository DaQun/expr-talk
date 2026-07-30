import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { floatToInt16, resampleFloat32 } from "./resample";

describe("audio resample", () => {
  it("downsamples 48k-like buffer to ~1/3 length at 16k", () => {
    const input = new Float32Array(480);
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((2 * Math.PI * i) / 48);
    }
    const out = resampleFloat32(input, 48000, 16000);
    assert.equal(out.length, 160);
  });

  it("clamps float to int16 range", () => {
    const pcm = floatToInt16(new Float32Array([0, 1, -1, 2, -2]));
    assert.equal(pcm[0], 0);
    assert.equal(pcm[1], 0x7fff);
    assert.equal(pcm[2], -0x8000);
    assert.ok(pcm[3] <= 0x7fff);
    assert.ok(pcm[4] >= -0x8000);
  });
});
