-- Corrige câmeras RTMP criadas pelo autoatendimento móvel antes de a política
-- ser imposta no backend. Em modo motion, recordingEnabled=false significa
-- "nenhum evento gravando agora"; a câmera continua armada pelo detector.
--
-- A retenção segue o grupo quando ele existe e possui valor válido. Sem grupo
-- (ou em dados legados inválidos), a câmera fica com a política própria de 3
-- dias, evitando apontar `retentionFollowsGroup` para uma retenção inexistente.
UPDATE "Camera" AS camera
SET
  "recordingMode" = 'motion',
  "recordingEnabled" = false,
  "motionTrigger" = 'SYSTEM',
  "aiEnabled" = true,
  "retentionDays" = COALESCE(
    (
      SELECT grp."retentionDays"
      FROM "CameraGroup" AS grp
      WHERE grp."id" = camera."groupId"
        AND grp."retentionDays" >= 1
    ),
    3
  ),
  "retentionFollowsGroup" = EXISTS (
    SELECT 1
    FROM "CameraGroup" AS grp
    WHERE grp."id" = camera."groupId"
      AND grp."retentionDays" >= 1
  ),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE camera."sourceMode" = 'rtmp_push'
  AND camera."isPrivate" = true;
