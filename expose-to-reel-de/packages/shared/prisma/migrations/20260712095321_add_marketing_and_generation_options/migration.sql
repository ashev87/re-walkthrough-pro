-- AlterEnum
ALTER TYPE "MediaKind" ADD VALUE 'VOICEOVER';

-- AlterTable
ALTER TABLE "GenerationJob" ADD COLUMN     "options" JSONB;

-- AlterTable
ALTER TABLE "PropertyProject" ADD COLUMN     "marketingTexts" JSONB;

-- AlterTable
ALTER TABLE "Shot" ADD COLUMN     "preferAiVideo" BOOLEAN NOT NULL DEFAULT false;
