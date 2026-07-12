import { env, LocalObjectStorage, prisma, signLocalStorageUrl } from "@e2r/shared";
import { NextResponse } from "next/server";
import { jsonError, requireUser, withApi } from "@/server/api";

type Context = { params: Promise<{ key: string[] }> };

/**
 * Auslieferung lokaler Storage-Objekte — ausschließlich über signierte,
 * ablaufende URLs UND eine gültige Session der passenden Organisation.
 * Quellmedien sind damit nie öffentlich erreichbar.
 */
export const GET = withApi(async (request: Request, context: Context) => {
  if (env.storageDriver !== "local") {
    return jsonError("Lokaler Storage ist nicht aktiv.", 404);
  }
  const { key: keyParts } = await context.params;
  const key = keyParts.map(decodeURIComponent).join("/");

  const url = new URL(request.url);
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") ?? "";
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return jsonError("Link abgelaufen.", 403);
  }
  if (signLocalStorageUrl(key, exp) !== sig) {
    return jsonError("Ungültige Signatur.", 403);
  }

  const user = await requireUser(request);
  if (!key.startsWith(`org/${user.organizationId}/`)) {
    return jsonError("Kein Zugriff.", 403);
  }

  const storage = new LocalObjectStorage();
  let data: Buffer;
  try {
    data = await storage.get(key);
  } catch {
    return jsonError("Objekt nicht gefunden.", 404);
  }

  const asset = await prisma.mediaAsset.findUnique({
    where: { storageKey: key },
    select: { mimeType: true, filename: true },
  });
  // mimeType stammt aus der Upload-Validierung (Whitelist + Magic-Bytes) bzw.
  // aus fest kodierten Worker-Typen — nie ungeprüft vom Client. Die Header
  // unten sind Defense-in-Depth gegen MIME-Sniffing/aktive Inhalte.
  const contentType = asset?.mimeType ?? "application/octet-stream";
  const securityHeaders = {
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox; default-src 'none'",
    "cross-origin-resource-policy": "same-origin",
  } as const;

  // Range-Support für Video-Seeking im Browser.
  const range = request.headers.get("range");
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1;
      if (start <= end && start < data.length) {
        return new NextResponse(new Uint8Array(data.subarray(start, end + 1)), {
          status: 206,
          headers: {
            ...securityHeaders,
            "content-type": contentType,
            "content-range": `bytes ${start}-${end}/${data.length}`,
            "accept-ranges": "bytes",
            "content-length": String(end - start + 1),
            "cache-control": "private, no-store",
          },
        });
      }
    }
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      ...securityHeaders,
      "content-type": contentType,
      "content-length": String(data.length),
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
      ...(asset?.filename
        ? {
            "content-disposition": `inline; filename="${encodeURIComponent(asset.filename)}"`,
          }
        : {}),
    },
  });
});
