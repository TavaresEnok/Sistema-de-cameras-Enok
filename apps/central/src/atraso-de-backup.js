'use strict';

/**
 * BACKUP ATRASADO precisa AVISAR.
 *
 * A política normal é uma cópia por semana. O alerta só pode disparar depois
 * da janela semanal, senão uma cópia perfeitamente em dia apareceria como
 * atrasada durante cinco dos sete dias do ciclo.
 *
 * A régua é por CONTAGEM DE DIAS desde a última cópia recebida, e o alerta tem
 * dois degraus porque as causas são diferentes:
 *
 *   · 8 dias  → ATENÇÃO. O ciclo semanal venceu sem nova cópia.
 *   · 15 dias → GRAVE. Dois ciclos consecutivos foram perdidos.
 *
 * Instalação que NUNCA enviou é caso à parte: pode ser recém-instalada (o
 * primeiro envio ocorre após a preparação inicial) ou pode estar com o envio desligado. Só vira
 * alerta depois da janela do primeiro envio.
 */

const DIAS_ATENCAO = 8;
const DIAS_GRAVE = 15;
/** Antes disso, uma instalação nova ainda não deveria ter enviado nada. */
const DIAS_DE_CARENCIA_DA_PRIMEIRA = 2;

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * @param {object} e
 * @param {string|null} e.ultimoBackupEm  ISO da última cópia recebida
 * @param {string|null} e.criadaEm        ISO de quando a instalação foi criada
 * @param {number} e.agoraMs
 */
function avaliarAtrasoDeBackup(e) {
  const agora = Number(e.agoraMs) || Date.now();
  const ultimo = e.ultimoBackupEm ? Date.parse(e.ultimoBackupEm) : NaN;

  if (!Number.isFinite(ultimo)) {
    const criada = e.criadaEm ? Date.parse(e.criadaEm) : NaN;
    const diasDeVida = Number.isFinite(criada) ? (agora - criada) / DIA_MS : Infinity;
    if (diasDeVida < DIAS_DE_CARENCIA_DA_PRIMEIRA) {
      return { nivel: 'ok', motivo: 'aguardando-primeira', dias: null };
    }
    return { nivel: 'grave', motivo: 'nunca-enviou', dias: null };
  }

  const dias = Math.floor((agora - ultimo) / DIA_MS);
  if (dias >= DIAS_GRAVE) return { nivel: 'grave', motivo: 'atrasado', dias };
  if (dias >= DIAS_ATENCAO) return { nivel: 'atencao', motivo: 'atrasado', dias };
  return { nivel: 'ok', motivo: 'em-dia', dias };
}

/** Texto para o painel e para o alerta. */
function explicarAtraso(a, installationId) {
  if (a.motivo === 'nunca-enviou') {
    return `${installationId}: NUNCA enviou cópia de segurança. Confira o container vms-backup-upload na máquina dela.`;
  }
  if (a.motivo === 'atrasado') {
    return `${installationId}: sem cópia de segurança há ${a.dias} dias.`;
  }
  return null;
}

module.exports = { avaliarAtrasoDeBackup, explicarAtraso, DIAS_ATENCAO, DIAS_GRAVE };
