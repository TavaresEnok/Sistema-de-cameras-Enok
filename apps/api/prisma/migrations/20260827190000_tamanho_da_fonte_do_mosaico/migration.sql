-- Guarda o TAMANHO do stream 2, para conferir o padrão de instalação
-- (principal 1080p H.265 + stream 2 480p H.264). Ver padrao-de-stream.helper.ts.
ALTER TABLE "Camera" ADD COLUMN "gridSourceWidth" INTEGER;
ALTER TABLE "Camera" ADD COLUMN "gridSourceHeight" INTEGER;
