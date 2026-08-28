-- O health-check antigo copiava o codec detectado para recordingVideoCodec,
-- confundindo telemetria com política. Câmeras privadas criadas no aplicativo
-- devem preservar o bitstream recebido, sem transcodificação implícita.
UPDATE "Camera"
SET "recordingVideoCodec" = 'original'
WHERE "isPrivate" = true
  AND "sourceMode" = 'rtmp_push';
