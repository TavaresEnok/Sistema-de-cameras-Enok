-- Compartilhamento de mosaicos e rondas: o administrador monta uma vez e
-- entrega a pessoas ou grupos. Ver compartilhamento.helper.ts.
--
-- Tudo nasce com valor padrão para não mexer em nada que já existe: todo
-- mosaico e toda ronda continuam ativos, visíveis no aplicativo e sem
-- destinatário nenhum — exatamente o comportamento de hoje.

ALTER TABLE "LiveLayout" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "LiveLayout" ADD COLUMN "showOnMobile" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Ronda" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Ronda" ADD COLUMN "showOnMobile" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "LiveLayoutShare" (
    "id" TEXT NOT NULL,
    "layoutId" TEXT NOT NULL,
    "userId" TEXT,
    "groupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LiveLayoutShare_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RondaShare" (
    "id" TEXT NOT NULL,
    "rondaId" TEXT NOT NULL,
    "userId" TEXT,
    "groupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RondaShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveLayoutShare_layoutId_userId_key" ON "LiveLayoutShare"("layoutId", "userId");
CREATE UNIQUE INDEX "LiveLayoutShare_layoutId_groupId_key" ON "LiveLayoutShare"("layoutId", "groupId");
CREATE INDEX "LiveLayoutShare_userId_idx" ON "LiveLayoutShare"("userId");
CREATE INDEX "LiveLayoutShare_groupId_idx" ON "LiveLayoutShare"("groupId");

CREATE UNIQUE INDEX "RondaShare_rondaId_userId_key" ON "RondaShare"("rondaId", "userId");
CREATE UNIQUE INDEX "RondaShare_rondaId_groupId_key" ON "RondaShare"("rondaId", "groupId");
CREATE INDEX "RondaShare_userId_idx" ON "RondaShare"("userId");
CREATE INDEX "RondaShare_groupId_idx" ON "RondaShare"("groupId");

ALTER TABLE "LiveLayoutShare" ADD CONSTRAINT "LiveLayoutShare_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "LiveLayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveLayoutShare" ADD CONSTRAINT "LiveLayoutShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveLayoutShare" ADD CONSTRAINT "LiveLayoutShare_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CameraGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RondaShare" ADD CONSTRAINT "RondaShare_rondaId_fkey" FOREIGN KEY ("rondaId") REFERENCES "Ronda"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RondaShare" ADD CONSTRAINT "RondaShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RondaShare" ADD CONSTRAINT "RondaShare_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CameraGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
