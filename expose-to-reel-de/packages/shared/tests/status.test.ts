import { describe, expect, test } from "vitest";
import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
  isExportAllowed,
} from "../src/domain/status";

describe("Projekt-Zustandsmaschine", () => {
  test("erlaubt den Standard-Happy-Path", () => {
    expect(canTransition("DRAFT", "NEEDS_REVIEW")).toBe(true);
    expect(canTransition("NEEDS_REVIEW", "GENERATING")).toBe(true);
    expect(canTransition("GENERATING", "READY")).toBe(true);
    expect(canTransition("READY", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "EXPORTED")).toBe(true);
  });

  test("verbietet Export/Freigabe-Abkürzungen", () => {
    expect(canTransition("DRAFT", "APPROVED")).toBe(false);
    expect(canTransition("DRAFT", "EXPORTED")).toBe(false);
    expect(canTransition("NEEDS_REVIEW", "APPROVED")).toBe(false);
    expect(canTransition("NEEDS_REVIEW", "EXPORTED")).toBe(false);
    expect(canTransition("GENERATING", "APPROVED")).toBe(false);
    expect(canTransition("READY", "EXPORTED")).toBe(false);
    expect(canTransition("FAILED", "APPROVED")).toBe(false);
  });

  test("erlaubt Fehler- und Abbruchpfade", () => {
    expect(canTransition("GENERATING", "FAILED")).toBe(true);
    expect(canTransition("GENERATING", "NEEDS_REVIEW")).toBe(true);
    expect(canTransition("FAILED", "GENERATING")).toBe(true);
    expect(canTransition("APPROVED", "NEEDS_REVIEW")).toBe(true);
  });

  test("assertTransition wirft typisierten Fehler", () => {
    expect(() => assertTransition("DRAFT", "EXPORTED")).toThrow(
      InvalidTransitionError
    );
    expect(() => assertTransition("READY", "APPROVED")).not.toThrow();
  });

  test("Export ist nur nach Freigabe erlaubt", () => {
    expect(isExportAllowed("APPROVED")).toBe(true);
    expect(isExportAllowed("EXPORTED")).toBe(true);
    for (const status of ["DRAFT", "NEEDS_REVIEW", "GENERATING", "READY", "FAILED"] as const) {
      expect(isExportAllowed(status)).toBe(false);
    }
  });
});
