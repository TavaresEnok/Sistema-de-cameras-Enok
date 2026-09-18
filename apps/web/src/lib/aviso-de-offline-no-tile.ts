/**
 * O tile do mosaico deve cobrir a imagem com o aviso "Offline"?
 *
 * Duas fontes de verdade discordam por minutos a cada reinício:
 *   · `camera.status` vem de SONDAGEM periódica do servidor — depois de um
 *     reinício ele fica "offline" até o próximo ciclo;
 *   · o PLAYER sabe se há quadro chegando AGORA.
 *
 * Quem vê imagem viva está certo. O defeito (IBTelecom, 18/09/2026, logo após
 * reiniciar as VMs): a regra só aceitava o estado `playing` como prova de vida,
 * e o player informa `fallback` quando toca por contingência (WebRTC → HLS, ou
 * H.265 → H.264) — com vídeo rodando. Resultado: tag "Offline" escura sobre um
 * vídeo que rodava por trás, por ~2 minutos, até a sondagem alcançar.
 *
 * `fallback` É imagem viva. Só `loading` e `error` (ou player sem estado ainda)
 * deixam o aviso aparecer.
 */
export type EstadoDoPlayer = 'loading' | 'playing' | 'fallback' | 'error';

export function playerTemImagemViva(estado: EstadoDoPlayer | null | undefined): boolean {
  return estado === 'playing' || estado === 'fallback';
}

export function mostrarAvisoDeOffline(
  statusDaCamera: string | null | undefined,
  estadoDoPlayer: EstadoDoPlayer | null | undefined,
): boolean {
  const offlinePelaSondagem = statusDaCamera === 'offline' || statusDaCamera === 'no_signal';
  return offlinePelaSondagem && !playerTemImagemViva(estadoDoPlayer);
}
