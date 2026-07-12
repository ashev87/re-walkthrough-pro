-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'NEEDS_REVIEW', 'GENERATING', 'READY', 'APPROVED', 'EXPORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('MANUAL_UPLOAD', 'IMMOSCOUT24_API');

-- CreateEnum
CREATE TYPE "MarketingType" AS ENUM ('KAUF', 'MIETE');

-- CreateEnum
CREATE TYPE "AddressVisibility" AS ENUM ('FULL', 'STREET_ONLY', 'CITY_ONLY');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('SOURCE_IMAGE', 'NORMALIZED_IMAGE', 'SCENE_CLIP', 'FINAL_VIDEO', 'POSTER', 'CAPTIONS');

-- CreateEnum
CREATE TYPE "RoomLabel" AS ENUM ('AUSSENANSICHT', 'EINGANG', 'FLUR', 'WOHNZIMMER', 'KUECHE', 'ESSBEREICH', 'SCHLAFZIMMER', 'ARBEITSZIMMER', 'BAD', 'BALKON_TERRASSE', 'GARTEN', 'AUSSICHT', 'GRUNDRISS', 'SONSTIGES');

-- CreateEnum
CREATE TYPE "ShotStatus" AS ENUM ('PENDING', 'RENDERING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProviderConnectionStatus" AS ENUM ('DISABLED', 'CONFIGURED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyProject" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceType" "SourceType" NOT NULL DEFAULT 'MANUAL_UPLOAD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingData" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "marketingType" "MarketingType" NOT NULL,
    "objectType" TEXT NOT NULL,
    "titel" TEXT NOT NULL,
    "plz" TEXT NOT NULL,
    "ort" TEXT NOT NULL,
    "strasse" TEXT,
    "hausnummer" TEXT,
    "addressVisibility" "AddressVisibility" NOT NULL DEFAULT 'CITY_ONLY',
    "kaufpreis" DECIMAL(12,2),
    "kaltmiete" DECIMAL(12,2),
    "nebenkosten" DECIMAL(12,2),
    "warmmiete" DECIMAL(12,2),
    "zimmer" DECIMAL(4,1),
    "wohnflaeche" DECIMAL(8,2),
    "grundstuecksflaeche" DECIMAL(10,2),
    "baujahr" INTEGER,
    "provision" TEXT,
    "energieausweisTyp" TEXT,
    "energiekennwert" DECIMAL(6,1),
    "energieklasse" TEXT,
    "energietraeger" TEXT,
    "beschreibung" TEXT,

    CONSTRAINT "ListingData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "perceptualHash" TEXT,
    "whiteRatio" DOUBLE PRECISION,
    "caption" TEXT,
    "sortIndex" INTEGER NOT NULL DEFAULT 0,
    "roomLabel" "RoomLabel",
    "isLowResolution" BOOLEAN NOT NULL DEFAULT false,
    "isLikelyFloorplan" BOOLEAN NOT NULL DEFAULT false,
    "duplicateOfId" TEXT,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "roomLabel" "RoomLabel" NOT NULL,
    "sortIndex" INTEGER NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "cameraMove" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL DEFAULT 4,
    "status" "ShotStatus" NOT NULL DEFAULT 'PENDING',
    "sceneAssetId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "queueJobId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "errorMessage" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "generationJobId" TEXT,
    "version" INTEGER NOT NULL,
    "master16x9AssetId" TEXT NOT NULL,
    "reel9x16AssetId" TEXT NOT NULL,
    "posterAssetId" TEXT,
    "captionsAssetId" TEXT,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RightsAttestation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "sourceDescription" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RightsAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoVersionId" TEXT NOT NULL,
    "checklist" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotSha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "ProviderConnectionStatus" NOT NULL DEFAULT 'DISABLED',
    "encryptedCredentials" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "PropertyProject_organizationId_status_idx" ON "PropertyProject"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ListingData_projectId_key" ON "ListingData"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");

-- CreateIndex
CREATE INDEX "MediaAsset_projectId_kind_sortIndex_idx" ON "MediaAsset"("projectId", "kind", "sortIndex");

-- CreateIndex
CREATE INDEX "Shot_projectId_sortIndex_idx" ON "Shot"("projectId", "sortIndex");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationJob_idempotencyKey_key" ON "GenerationJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GenerationJob_projectId_createdAt_idx" ON "GenerationJob"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VideoVersion_projectId_version_key" ON "VideoVersion"("projectId", "version");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConnection_organizationId_provider_key" ON "ProviderConnection"("organizationId", "provider");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyProject" ADD CONSTRAINT "PropertyProject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingData" ADD CONSTRAINT "ListingData_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PropertyProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PropertyProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shot" ADD CONSTRAINT "Shot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PropertyProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shot" ADD CONSTRAINT "Shot_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PropertyProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoVersion" ADD CONSTRAINT "VideoVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PropertyProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoVersion" ADD CONSTRAINT "VideoVersion_generationJobId_fkey" FOREIGN KEY ("generationJobId") REFERENCES "GenerationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RightsAttestation" ADD CONSTRAINT "RightsAttestation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PropertyProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RightsAttestation" ADD CONSTRAINT "RightsAttestation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRecord" ADD CONSTRAINT "ApprovalRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PropertyProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRecord" ADD CONSTRAINT "ApprovalRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRecord" ADD CONSTRAINT "ApprovalRecord_videoVersionId_fkey" FOREIGN KEY ("videoVersionId") REFERENCES "VideoVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PropertyProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
