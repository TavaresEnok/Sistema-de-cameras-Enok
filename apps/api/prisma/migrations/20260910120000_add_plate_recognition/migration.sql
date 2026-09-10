-- Leitura de placas: configuração por câmera, histórico indexado e listas.
ALTER TABLE "Camera"
  ADD COLUMN IF NOT EXISTS "plateRecognitionEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "plateRecognitionRoi" JSONB,
  ADD COLUMN IF NOT EXISTS "plateRecognitionDirection" TEXT NOT NULL DEFAULT 'BOTH',
  ADD COLUMN IF NOT EXISTS "plateRecognitionFps" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "plateRecognitionMinConfidence" INTEGER NOT NULL DEFAULT 75,
  ADD COLUMN IF NOT EXISTS "plateRecognitionCooldownSeconds" INTEGER NOT NULL DEFAULT 20;

CREATE TABLE IF NOT EXISTS "PlateRecognition" (
  "id" TEXT NOT NULL,
  "cameraId" TEXT NOT NULL,
  "plateRaw" TEXT NOT NULL,
  "plateNormalized" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "direction" TEXT,
  "listKind" TEXT,
  "snapshotPath" TEXT,
  "metadata" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlateRecognition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlateRecognition_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "PlateRecognition_cameraId_occurredAt_idx" ON "PlateRecognition"("cameraId", "occurredAt");
CREATE INDEX IF NOT EXISTS "PlateRecognition_plateNormalized_occurredAt_idx" ON "PlateRecognition"("plateNormalized", "occurredAt");
CREATE INDEX IF NOT EXISTS "PlateRecognition_occurredAt_idx" ON "PlateRecognition"("occurredAt");

CREATE TABLE IF NOT EXISTS "PlateListEntry" (
  "id" TEXT NOT NULL,
  "plateNormalized" TEXT NOT NULL,
  "plateDisplay" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "label" TEXT,
  "ownerName" TEXT,
  "vehicleInfo" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "validFrom" TIMESTAMP(3),
  "validUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlateListEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlateListEntry_plateNormalized_kind_key" UNIQUE ("plateNormalized", "kind")
);
CREATE INDEX IF NOT EXISTS "PlateListEntry_kind_active_idx" ON "PlateListEntry"("kind", "active");
