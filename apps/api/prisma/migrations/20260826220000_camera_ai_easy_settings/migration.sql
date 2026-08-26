ALTER TABLE "Camera"
  ADD COLUMN "aiObjectClasses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "aiSensitivity" TEXT NOT NULL DEFAULT 'balanced';
