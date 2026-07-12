import { describe, expect, test } from "vitest";
import {
  decryptCredentials,
  encryptCredentials,
  hashPassword,
  hmacSign,
  hmacVerify,
  sha256Hex,
  verifyPassword,
} from "../src/crypto";

describe("Krypto-Helfer", () => {
  test("Passwort-Hash & -Verifikation (scrypt)", () => {
    const hash = hashPassword("demo1234");
    expect(hash.startsWith("scrypt:")).toBe(true);
    expect(verifyPassword("demo1234", hash)).toBe(true);
    expect(verifyPassword("falsch", hash)).toBe(false);
    expect(verifyPassword("demo1234", "kaputt")).toBe(false);
  });

  test("Credentials AES-256-GCM Roundtrip", () => {
    const secret = JSON.stringify({ clientId: "abc", clientSecret: "xyz" });
    const blob = encryptCredentials(secret);
    expect(blob).not.toContain("abc");
    expect(decryptCredentials(blob)).toBe(secret);
  });

  test("manipulierte Ciphertexte werden abgelehnt", () => {
    const blob = encryptCredentials("geheim");
    const [iv, tag, data] = blob.split(":");
    const tampered = [iv, tag, Buffer.from("evil").toString("base64")].join(":");
    expect(() => decryptCredentials(tampered)).toThrow();
    expect(() => decryptCredentials(`${iv}:${data}`)).toThrow();
  });

  test("HMAC-Signatur & -Verifikation", () => {
    const signature = hmacSign("payload");
    expect(hmacVerify("payload", signature)).toBe(true);
    expect(hmacVerify("anders", signature)).toBe(false);
    expect(hmacVerify("payload", "fake")).toBe(false);
  });

  test("sha256Hex ist deterministisch", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
    expect(sha256Hex("abc")).toHaveLength(64);
  });
});
