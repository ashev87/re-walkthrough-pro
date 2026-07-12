import { afterEach, describe, expect, test } from "vitest";
import {
  FotoMotionVideoProvider,
  getVideoProvider,
  MOCK_WATERMARK_LABEL,
} from "../src/providers/videoGeneration/index";

const ORIGINAL = process.env.VIDEO_PROVIDER;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.VIDEO_PROVIDER;
  else process.env.VIDEO_PROVIDER = ORIGINAL;
});

describe("Video-Provider-Factory", () => {
  test("Standard ist Foto-Motion ohne Wasserzeichen", () => {
    delete process.env.VIDEO_PROVIDER;
    const provider = getVideoProvider();
    expect(provider).toBeInstanceOf(FotoMotionVideoProvider);
    expect(provider.key).toBe("foto_motion");
    expect(provider.watermarkLabel).toBeUndefined();
  });

  test("VIDEO_PROVIDER=mock nutzt denselben Renderer mit MOCK-Label", () => {
    process.env.VIDEO_PROVIDER = "mock";
    const provider = getVideoProvider();
    expect(provider).toBeInstanceOf(FotoMotionVideoProvider);
    expect(provider.watermarkLabel).toBe(MOCK_WATERMARK_LABEL);
    expect(provider.watermarkLabel).toContain("MOCK");
  });

  test("VIDEO_PROVIDER=external fällt unkonfiguriert auf Foto-Motion zurück", () => {
    process.env.VIDEO_PROVIDER = "external";
    const provider = getVideoProvider();
    expect(provider).toBeInstanceOf(FotoMotionVideoProvider);
    expect(provider.watermarkLabel).toBeUndefined();
  });
});
