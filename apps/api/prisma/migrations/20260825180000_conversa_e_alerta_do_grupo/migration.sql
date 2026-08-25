-- CONVERSA DO GRUPO E BOTÃO DE PÂNICO
--
-- Pedido em 25/08/2026: num condomínio com dez moradores, quem vê algo estranho
-- clica em ALERTA e todos daquele grupo recebem push com vibração. O alerta É
-- uma mensagem marcada, na mesma conversa — alerta sem conversa é beco sem
-- saída: dez pessoas recebem "atenção na câmera 3" e ninguém consegue responder
-- "já vi, é o entregador".

CREATE TYPE "GroupMessageKind" AS ENUM ('TEXT', 'ALERT');

CREATE TABLE "GroupMessage" (
    "id"        TEXT NOT NULL,
    "groupId"   TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "kind"      "GroupMessageKind" NOT NULL DEFAULT 'TEXT',
    "body"      TEXT NOT NULL,
    "cameraId"  TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Calculado na CRIAÇÃO: a política de retenção pode mudar depois, e
    -- mensagem já enviada não deve mudar de prazo pelas costas de quem a leu.
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GroupMessage_pkey" PRIMARY KEY ("id")
);

-- A conversa é sempre lida por grupo e em ordem de tempo.
CREATE INDEX "GroupMessage_groupId_createdAt_idx" ON "GroupMessage"("groupId", "createdAt");
-- A varredura de expiração precisa achar as vencidas sem varrer a tabela toda.
CREATE INDEX "GroupMessage_expiresAt_idx" ON "GroupMessage"("expiresAt");

ALTER TABLE "GroupMessage" ADD CONSTRAINT "GroupMessage_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "CameraGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GroupMessage" ADD CONSTRAINT "GroupMessage_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL e não CASCADE: apagar a câmera não pode apagar o histórico do
-- incidente que aconteceu nela.
ALTER TABLE "GroupMessage" ADD CONSTRAINT "GroupMessage_cameraId_fkey"
    FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE SET NULL ON UPDATE CASCADE;
