'use strict';

/**
 * QUANDO APAGAR o arquivo de reativação — e por que isso não é detalhe.
 *
 * O arquivo de cancelamento guarda a configuração do cliente cifrada em
 * AES-256-GCM, para o caso de ele recontratar. A política de privacidade
 * publicada promete que ele é apagado em 24 meses.
 *
 * Em 17/08/2026 essa promessa NÃO era cumprida: o vencimento era calculado e
 * gravado, e nada varria o diretório. O arquivo do cliente cancelado ficaria no
 * disco para sempre — promessa de privacidade escrita e não cumprida é pior que
 * promessa não feita.
 *
 * A regra vive aqui, separada do disco, porque é onde se erra por descuido: um
 * "vencido" mal calculado apaga o arquivo de quem ainda podia recontratar.
 */

/**
 * Este arquivo já venceu?
 *
 * Só apaga quando há data VÁLIDA e ela ficou no passado. Data ausente ou
 * ilegível NUNCA apaga: na dúvida, o dado do cliente fica. Errar para o lado de
 * guardar custa disco; errar para o outro destrói o que ele pagou para
 * preservar, sem volta.
 */
function venceu(expiresAt, agora = new Date()) {
  if (!expiresAt) return false;
  const limite = new Date(expiresAt);
  if (Number.isNaN(limite.getTime())) return false;
  return limite.getTime() <= agora.getTime();
}

/**
 * Quais arquivos apagar nesta varredura.
 *
 * Recebe as instalações com o estado do arquivo e devolve só as que têm arquivo
 * DISPONÍVEL e vencido. Instalação sem arquivo, ou com arquivo já removido, não
 * entra — repetir a exclusão encheria a auditoria de eventos falsos.
 */
function selecionarVencidos(instalacoes, agora = new Date()) {
  return (Array.isArray(instalacoes) ? instalacoes : [])
    .filter((i) => i && i.reactivationArchive)
    .filter((i) => i.reactivationArchive.state === 'AVAILABLE')
    .filter((i) => venceu(i.reactivationArchive.expiresAt, agora))
    .map((i) => ({
      installationId: i.id,
      expiresAt: i.reactivationArchive.expiresAt,
    }));
}

module.exports = { venceu, selecionarVencidos };
