import { describe, it, expect } from "vitest";
import core from "../../static/js/core.js";

describe("checkpoint schedule", () => {
  it("has 11 strictly increasing checkpoints from 500 to 30000", () => {
    expect(core.CHECKPOINTS).toHaveLength(11);
    expect(core.CHECKPOINTS[0]).toBe(500);
    expect(core.CHECKPOINTS.at(-1)).toBe(30000);
    for (let i = 1; i < core.CHECKPOINTS.length; i++) {
      expect(core.CHECKPOINTS[i]).toBeGreaterThan(core.CHECKPOINTS[i - 1]);
    }
  });

  it("frame layout matches the rendered videos (273 frames, ffprobe)", () => {
    // render_progress.py: 21 frames per checkpoint, final one held 3x
    expect(core.totalFrames()).toBe(273);
  });

  it("checkpointTime seeks to the middle of each hold segment", () => {
    expect(core.checkpointTime(0)).toBeCloseTo(10.5 / 30, 6);
    expect(core.checkpointTime(6)).toBeCloseTo(4.55, 6);
  });

  it("checkpointTime is strictly increasing and inside the video duration", () => {
    const duration = core.totalFrames() / core.VIDEO_FPS; // 9.1 s
    let prev = -1;
    for (let k = 0; k < core.CHECKPOINTS.length; k++) {
      const t = core.checkpointTime(k);
      expect(t).toBeGreaterThan(prev);
      expect(t).toBeLessThan(duration);
      prev = t;
    }
  });
});

describe("clamp", () => {
  it("clamps below, inside, above", () => {
    expect(core.clamp(-5, 0, 100)).toBe(0);
    expect(core.clamp(42, 0, 100)).toBe(42);
    expect(core.clamp(140, 0, 100)).toBe(100);
  });
});

describe("loaderProgress", () => {
  it("is 0 before anything loaded and 1 when everything is done", () => {
    expect(core.loaderProgress(0, 5, 0, 1000)).toBe(0);
    expect(core.loaderProgress(5, 5, 1000, 1000)).toBe(1);
  });

  it("weights images at 8% by default", () => {
    expect(core.loaderProgress(5, 5, 0, 1000)).toBeCloseTo(0.08, 6);
    expect(core.loaderProgress(0, 5, 1000, 1000)).toBeCloseTo(0.92, 6);
  });

  it("is monotonic in video bytes", () => {
    let prev = -1;
    for (let b = 0; b <= 1000; b += 100) {
      const p = core.loaderProgress(0, 1, b, 1000);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it("clamps byte overrun and tolerates zero totals", () => {
    expect(core.loaderProgress(1, 1, 2000, 1000)).toBe(1);
    expect(core.loaderProgress(0, 0, 0, 0)).toBeCloseTo(0.08, 6); // no images: img part complete
  });
});

describe("formatIteration", () => {
  it("formats with US thousands separators", () => {
    expect(core.formatIteration(500)).toBe("iteration 500");
    expect(core.formatIteration(10000)).toBe("iteration 10,000");
    expect(core.formatIteration(30000)).toBe("iteration 30,000");
  });
});

describe("tickFraction", () => {
  it("spans [0, 1] over the checkpoint count", () => {
    const n = core.CHECKPOINTS.length;
    expect(core.tickFraction(0, n)).toBe(0);
    expect(core.tickFraction(n - 1, n)).toBe(1);
    expect(core.tickFraction(5, n)).toBeCloseTo(0.5, 6);
  });

  it("degenerate n does not divide by zero", () => {
    expect(core.tickFraction(0, 1)).toBe(0);
  });
});

describe("fly-through arena data", () => {
  it("knows the methods and scenes of the arena", () => {
    expect(Object.keys(core.FLY_METHODS)).toContain("sad");
    expect(Object.keys(core.FLY_METHODS)).toContain("gs");
    expect(Object.keys(core.FLY_METHODS)).toContain("mcmc");
    expect(core.FLY_SCENES).toEqual(["flowers", "bicycle", "garden", "stump"]);
  });

  it("builds the expected video paths", () => {
    expect(core.flyPath("flowers", "sad")).toBe("static/videos/flythrough_sad_flowers.mp4");
    expect(core.flyPath("garden", "gs")).toBe("static/videos/flythrough_3dgs_garden.mp4");
    expect(core.flyPath("bicycle", "mcmc")).toBe("static/videos/flythrough_mcmc_bicycle.mp4");
  });

  it("benchedMethods returns every method not in the comparison", () => {
    const all = Object.keys(core.FLY_METHODS);
    expect(core.benchedMethods("sad", "gs")).toEqual(all.filter(m => m !== "sad" && m !== "gs"));
    expect(core.benchedMethods("sad", "gs")).toContain("mcmc");
    expect(core.benchedMethods("gs", "mcmc")).toContain("sad");
    // union of ring + bench is always the full method set
    expect(new Set(["sad", "gs", ...core.benchedMethods("sad", "gs")])).toEqual(new Set(all));
  });
});
