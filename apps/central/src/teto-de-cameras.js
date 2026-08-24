'use strict';

/**
 * TETO DE CÂMERAS contratado por instalação.
 *
 * "se dguardian dizer que vai pagar apenas para 50 cameras, eu tenho que
 *  limitar pela central o cadastro de 50" (dono, 24/08/2026)
 *
 * A regra mora aqui, e não solta no `server.js`, por causa de uma armadilha
 * específica: em JavaScript `Number('')` devolve 0. Um campo deixado em branco
 * no painel viraria "teto zero" e travaria TODO cadastro de câmera do cliente —
 * falha silenciosa e catastrófica, do tipo que só aparece quando o instalador
 * já está no cliente.
 *
 * Por isso:
 *   · vazio, null ou ausente  → SEM teto (null)
 *   · zero escrito à mão      → teto de verdade
 *   · texto ou negativo       → recusa, em vez de virar número estranho
 */

const SEM_TETO = null;

/** Normaliza o que veio do formulário. Devolve `{ ok, valor }`. */
function normalizarTeto(bruto) {
  if (bruto === null || bruto === undefined) return { ok: true, valor: SEM_TETO };
  const texto = String(bruto).trim();
  if (texto === '') return { ok: true, valor: SEM_TETO };
  const n = Number(texto);
  if (!Number.isFinite(n) || n < 0) return { ok: false, valor: SEM_TETO };
  return { ok: true, valor: Math.floor(n) };
}

/**
 * O valor que desce para a instalação no heartbeat.
 *
 * Reusa a normalização em vez de repetir a conta — a primeira versão daqui
 * caiu na MESMA armadilha do `Number('')`, e só o teste apanhou.
 */
function tetoParaHeartbeat(valorGravado) {
  const r = normalizarTeto(valorGravado);
  return r.ok ? r.valor : SEM_TETO;
}

module.exports = { normalizarTeto, tetoParaHeartbeat, SEM_TETO };
