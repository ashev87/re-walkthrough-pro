import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Lädt die .env vom Monorepo-Root (Marker: docker-compose.yml) in
 * process.env — ohne bestehende Variablen zu überschreiben und ohne
 * externe Abhängigkeit. Für Worker/Seeds; die Web-App nutzt @next/env.
 */
export function loadRootEnv(): void {
  let current = process.cwd();
  for (;;) {
    const candidate = path.join(current, ".env");
    if (existsSync(path.join(current, "docker-compose.yml"))) {
      if (existsSync(candidate)) applyEnvFile(candidate);
      return;
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function applyEnvFile(file: string): void {
  const content = readFileSync(file, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
