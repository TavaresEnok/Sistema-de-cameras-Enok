ALTER TABLE "Camera"
  ADD COLUMN "aiConfidence" INTEGER NOT NULL DEFAULT 70;

-- Preserva o significado das três opções antigas ao migrar câmeras existentes.
UPDATE "Camera"
SET "aiConfidence" = CASE "aiSensitivity"
  WHEN 'sensitive' THEN 60
  WHEN 'precise' THEN 78
  ELSE 70
END;

ALTER TABLE "Camera"
  ADD CONSTRAINT "Camera_aiConfidence_range"
  CHECK ("aiConfidence" BETWEEN 55 AND 90);
