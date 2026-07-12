import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { env } from "./env";

/**
 * Dünne ffmpeg/ffprobe-Hülle. Binärpfad: FFMPEG_PATH → PATH → winget-Links
 * (Windows-Entwicklungsrechner).
 */

function wingetLinkPath(binary: string): string | null {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const candidate = path.join(
    localAppData,
    "Microsoft",
    "WinGet",
    "Links",
    `${binary}.exe`
  );
  return existsSync(candidate) ? candidate : null;
}

let ffmpegResolved: string | undefined;
let ffprobeResolved: string | undefined;

export function ffmpegBinary(): string {
  if (!ffmpegResolved) {
    ffmpegResolved =
      env.ffmpegPath !== "ffmpeg"
        ? env.ffmpegPath
        : wingetLinkPath("ffmpeg") ?? "ffmpeg";
  }
  return ffmpegResolved;
}

export function ffprobeBinary(): string {
  if (!ffprobeResolved) {
    ffprobeResolved =
      env.ffprobePath !== "ffprobe"
        ? env.ffprobePath
        : wingetLinkPath("ffprobe") ?? "ffprobe";
  }
  return ffprobeResolved;
}

export interface RunResult {
  stdout: Buffer;
  stderr: string;
}

export function runBinary(
  binary: string,
  args: string[],
  options: { stdin?: Buffer; timeoutMs?: number } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${path.basename(binary)} Timeout nach ${options.timeoutMs}ms`));
    }, options.timeoutMs ?? 10 * 60 * 1000);

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code === 0) {
        resolve({ stdout: Buffer.concat(stdoutChunks), stderr });
      } else {
        reject(
          new Error(
            `${path.basename(binary)} beendet mit Code ${code}: ${stderr.slice(-2000)}`
          )
        );
      }
    });
    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}

export function runFfmpeg(
  args: string[],
  options: { stdin?: Buffer; timeoutMs?: number } = {}
): Promise<RunResult> {
  return runBinary(ffmpegBinary(), ["-hide_banner", "-y", ...args], options);
}

export interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
}

export interface ProbeResult {
  streams: ProbeStream[];
  format: { duration?: string; format_name?: string };
}

export async function ffprobe(filePath: string): Promise<ProbeResult> {
  const { stdout } = await runBinary(ffprobeBinary(), [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    filePath,
  ]);
  return JSON.parse(stdout.toString("utf8")) as ProbeResult;
}

export interface ImageSignals {
  /** 64-Bit aHash als Hex-String. */
  perceptualHash: string;
  /** Anteil sehr heller Pixel (0–1) — hoch bei Grundrissen/Scans. */
  whiteRatio: number;
}

/**
 * 8×8-Graustufen-Signatur eines Bildes (aHash + Weißanteil) für
 * deterministische Duplikat- und Grundriss-Heuristiken.
 */
export async function computeImageSignals(image: Buffer): Promise<ImageSignals> {
  const { stdout } = await runFfmpeg(
    [
      "-i",
      "pipe:0",
      "-vf",
      "scale=8:8:flags=area,format=gray",
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "pipe:1",
    ],
    { stdin: image, timeoutMs: 30_000 }
  );
  const pixels = stdout.subarray(0, 64);
  if (pixels.length < 64) {
    throw new Error("Bildsignatur fehlgeschlagen: zu wenige Pixel");
  }
  let sum = 0;
  for (const value of pixels) sum += value;
  const mean = sum / 64;

  let bits = 0n;
  let white = 0;
  for (let i = 0; i < 64; i++) {
    const value = pixels[i]!;
    if (value >= mean) bits |= 1n << BigInt(i);
    if (value >= 210) white++;
  }
  return {
    perceptualHash: bits.toString(16).padStart(16, "0"),
    whiteRatio: white / 64,
  };
}

/** Hamming-Distanz zweier aHash-Hex-Strings (0 = identisch). */
export function hammingDistance(hashA: string, hashB: string): number {
  let diff = BigInt(`0x${hashA}`) ^ BigInt(`0x${hashB}`);
  let count = 0;
  while (diff > 0n) {
    count += Number(diff & 1n);
    diff >>= 1n;
  }
  return count;
}
