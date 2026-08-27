-- MEMÓRIA DO MOSAICO: anota qual fonte leve cada câmera tem, para não procurar
-- de novo a cada reinício da API. Ver helpers/memoria-do-mosaico.helper.ts.
--
-- Tudo nulo por padrão = "nunca verificado", que é exatamente o estado de hoje.
-- Nenhuma câmera muda de comportamento até a primeira descoberta ser gravada.

ALTER TABLE "Camera" ADD COLUMN "gridHasSubStream" BOOLEAN;
ALTER TABLE "Camera" ADD COLUMN "gridSourceUrl" TEXT;
ALTER TABLE "Camera" ADD COLUMN "gridSourceCodec" TEXT;
ALTER TABLE "Camera" ADD COLUMN "gridRequiresSanitization" BOOLEAN;
ALTER TABLE "Camera" ADD COLUMN "gridProbeKey" TEXT;
ALTER TABLE "Camera" ADD COLUMN "gridProbedAt" TIMESTAMP(3);
