import {
  CAMERA_MOVES,
  getStorage,
  prisma,
  PROJECT_STATUS_LABELS,
} from "@e2r/shared";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/server/session";
import { getPublishingProvidersStatus } from "@/server/services/approval";
import type {
  ApprovalDto,
  JobDto,
  ListingDto,
  PhotoDto,
  ShotDto,
  VideoVersionDto,
} from "@/lib/dto";
import { ListingSection } from "@/components/project/ListingSection";
import { PhotosSection } from "@/components/project/PhotosSection";
import { ShotsSection } from "@/components/project/ShotsSection";
import { GenerationSection } from "@/components/project/GenerationSection";
import { ReviewSection } from "@/components/project/ReviewSection";

export const dynamic = "force-dynamic";

const num = (v: unknown): number | null => (v == null ? null : Number(v));

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;

  const project = await prisma.propertyProject.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      listingData: true,
      mediaAssets: {
        where: { kind: "SOURCE_IMAGE" },
        orderBy: { sortIndex: "asc" },
      },
      shots: { orderBy: { sortIndex: "asc" }, include: { mediaAsset: true } },
      generationJobs: { orderBy: { createdAt: "desc" }, take: 1 },
      videoVersions: { orderBy: { version: "desc" }, take: 1 },
      approvalRecords: {
        orderBy: { createdAt: "desc" },
        include: { user: { select: { name: true } } },
      },
      rightsAttestations: { orderBy: { confirmedAt: "desc" }, take: 1 },
    },
  });
  if (!project) notFound();

  const storage = getStorage();
  const signedUrl = (key: string) => storage.getSignedUrl(key, 30 * 60);

  const photos: PhotoDto[] = await Promise.all(
    project.mediaAssets.map(async (asset) => ({
      id: asset.id,
      filename: asset.filename,
      caption: asset.caption,
      roomLabel: asset.roomLabel,
      sortIndex: asset.sortIndex,
      width: asset.width,
      height: asset.height,
      isLowResolution: asset.isLowResolution,
      isLikelyFloorplan: asset.isLikelyFloorplan,
      duplicateOfId: asset.duplicateOfId,
      excluded: asset.excluded,
      url: await signedUrl(asset.storageKey),
    }))
  );

  const shots: ShotDto[] = await Promise.all(
    project.shots.map(async (shot) => ({
      id: shot.id,
      mediaAssetId: shot.mediaAssetId,
      roomLabel: shot.roomLabel,
      sortIndex: shot.sortIndex,
      selected: shot.selected,
      cameraMoveLabel: CAMERA_MOVES[shot.cameraMove]?.label ?? shot.cameraMove,
      prompt: shot.prompt,
      durationSec: shot.durationSec,
      status: shot.status,
      errorMessage: shot.errorMessage,
      imageUrl: await signedUrl(shot.mediaAsset.storageKey),
    }))
  );

  const listing: ListingDto | null = project.listingData
    ? {
        marketingType: project.listingData.marketingType,
        objectType: project.listingData.objectType,
        titel: project.listingData.titel,
        plz: project.listingData.plz,
        ort: project.listingData.ort,
        strasse: project.listingData.strasse,
        hausnummer: project.listingData.hausnummer,
        addressVisibility: project.listingData.addressVisibility,
        kaufpreis: num(project.listingData.kaufpreis),
        kaltmiete: num(project.listingData.kaltmiete),
        nebenkosten: num(project.listingData.nebenkosten),
        warmmiete: num(project.listingData.warmmiete),
        zimmer: num(project.listingData.zimmer),
        wohnflaeche: num(project.listingData.wohnflaeche),
        grundstuecksflaeche: num(project.listingData.grundstuecksflaeche),
        baujahr: project.listingData.baujahr,
        provision: project.listingData.provision,
        energieausweisTyp: project.listingData.energieausweisTyp,
        energiekennwert: num(project.listingData.energiekennwert),
        energieklasse: project.listingData.energieklasse,
        energietraeger: project.listingData.energietraeger,
        beschreibung: project.listingData.beschreibung,
      }
    : null;

  const latestJobRow = project.generationJobs[0];
  const latestJob: JobDto | null = latestJobRow
    ? {
        id: latestJobRow.id,
        status: latestJobRow.status,
        progress: latestJobRow.progress,
        currentStep: latestJobRow.currentStep,
        errorMessage: latestJobRow.errorMessage,
        createdAt: latestJobRow.createdAt.toISOString(),
      }
    : null;

  const versionRow = project.videoVersions[0];
  let latestVersion: VideoVersionDto | null = null;
  if (versionRow) {
    const assetIds = [
      versionRow.master16x9AssetId,
      versionRow.reel9x16AssetId,
      versionRow.posterAssetId,
      versionRow.captionsAssetId,
    ].filter((assetId): assetId is string => Boolean(assetId));
    const assets = await prisma.mediaAsset.findMany({
      where: { id: { in: assetIds } },
    });
    const urlFor = async (assetId: string | null) => {
      if (!assetId) return null;
      const asset = assets.find((a) => a.id === assetId);
      return asset ? await signedUrl(asset.storageKey) : null;
    };
    latestVersion = {
      id: versionRow.id,
      version: versionRow.version,
      durationSec: versionRow.durationSec,
      createdAt: versionRow.createdAt.toISOString(),
      masterUrl: (await urlFor(versionRow.master16x9AssetId))!,
      reelUrl: (await urlFor(versionRow.reel9x16AssetId))!,
      posterUrl: await urlFor(versionRow.posterAssetId),
      captionsUrl: await urlFor(versionRow.captionsAssetId),
    };
  }

  const approvals: ApprovalDto[] = project.approvalRecords.map((record) => ({
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    snapshotSha256: record.snapshotSha256,
    userName: record.user.name,
  }));

  const status = project.status;
  const hasAttestation = project.rightsAttestations.length > 0;

  return (
    <main className="container">
      <div style={{ marginBottom: "1rem" }}>
        <Link href="/" className="small">
          ← Zur Übersicht
        </Link>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            flexWrap: "wrap",
          }}
        >
          <h1 style={{ margin: 0 }}>{project.title}</h1>
          <span className={`badge ${status}`}>
            {PROJECT_STATUS_LABELS[status]}
          </span>
        </div>
        <p className="muted small">
          Quelle:{" "}
          {project.sourceType === "MANUAL_UPLOAD"
            ? "Manueller Upload"
            : project.sourceType === "PROPSTACK"
              ? "Propstack-Import"
              : "Autorisierte API-Verbindung"}{" "}
          · Angelegt: {project.createdAt.toLocaleString("de-DE")}
        </p>
      </div>

      <ListingSection projectId={project.id} status={status} listing={listing} />
      <PhotosSection
        projectId={project.id}
        status={status}
        photos={photos}
        hasAttestation={hasAttestation}
      />
      <ShotsSection
        projectId={project.id}
        status={status}
        shots={shots}
        photoCount={photos.length}
      />
      <GenerationSection
        projectId={project.id}
        status={status}
        latestJob={latestJob}
        shotCount={shots.filter((s) => s.selected).length}
      />
      <ReviewSection
        projectId={project.id}
        status={status}
        latestVersion={latestVersion}
        approvals={approvals}
        publishingProviders={getPublishingProvidersStatus()}
        hasAttestation={hasAttestation}
      />
    </main>
  );
}
