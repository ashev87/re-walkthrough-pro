/**
 * Einfaches In-Memory-Rate-Limit (Fixed Window) pro Schlüssel.
 * Ausreichend für den MVP (ein Web-Prozess); für Multi-Instanz-Betrieb auf
 * einen Redis-basierten Limiter umstellen (siehe README, Produktions-Hinweise).
 */

interface WindowState {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowState>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const state = windows.get(key);
  if (!state || state.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (state.count >= maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((state.resetAt - now) / 1000),
    };
  }
  windows.set(key, { ...state, count: state.count + 1 });
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Nur für Tests. */
export function resetRateLimits(): void {
  windows.clear();
}
