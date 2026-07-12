import { prisma } from "../../db";
import { getStorage } from "../../storage/index";
import type { PublishInput, PublishResult, PublishingProvider } from "./types";

/** Download-Export: signierte URLs für Master (16:9), Reel (9:16) und Poster. */
export class LocalDownloadPublisher implements PublishingProvider {
  readonly key = "local_download";
  readonly displayName = "Download/Export (lokal)";

  isEnabled(): boolean {
    return true;
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const version = await prisma.videoVersion.findUniqueOrThrow({
      where: { id: input.videoVersionId },
    });
    const assetIds = [
      version.master16x9AssetId,
      version.reel9x16AssetId,
      version.posterAssetId,
      version.captionsAssetId,
    ].filter((id): id is string => Boolean(id));

    const assets = await prisma.mediaAsset.findMany({
      where: { id: { in: assetIds } },
    });
    const storage = getStorage();
    const references: Record<string, string> = {};
    for (const asset of assets) {
      references[asset.kind === "FINAL_VIDEO" ? asset.filename : asset.kind] =
        await storage.getSignedUrl(asset.storageKey, 60 * 60);
    }
    return { providerKey: this.key, references };
  }
}
