-- RONDA: o mural passa de um mosaico para outro, sozinho.
--
-- Cada parada tem seu tempo, porque o portão merece mais que o corredor.
-- As paradas ficam em JSON porque são uma lista ORDENADA e curta, sempre lida
-- inteira: tabela separada custaria uma junção e uma coluna de ordem para
-- guardar o que já é um vetor.

CREATE TABLE "Ronda" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "paradas"   JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Ronda_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Ronda_userId_updatedAt_idx" ON "Ronda"("userId", "updatedAt");

ALTER TABLE "Ronda" ADD CONSTRAINT "Ronda_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
