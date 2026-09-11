-- Áudio é disponível por padrão. A reprodução continua muda nas grades até o
-- operador ativar o ícone de volume; este campo apenas preserva/transcodifica
-- a trilha para que o navegador possa recebê-la via WebRTC.
ALTER TABLE "Camera" ALTER COLUMN "audioEnabled" SET DEFAULT true;

-- Corrige o cadastro legado para que a política seja uniforme. Câmeras sem
-- microfone continuam sem áudio real, mas não perdem a possibilidade de
-- negociar a trilha quando o equipamento passar a fornecê-la.
UPDATE "Camera" SET "audioEnabled" = true WHERE "audioEnabled" = false;
