/**
 * QUAL EVENTO INICIA UMA GRAVAÇÃO — e por que não é sempre o mesmo.
 *
 * Até 11/08/2026 existia UMA regra, escrita direto no controller:
 *
 *     if (dto.type === 'MOTION_DETECTED') handleMotionDetected(...)
 *
 * Ou seja: só movimento gravava. A IA já detectava pessoa e veículo (YOLO26n
 * rodando na GPU, com confirmação por persistência), e esses eventos
 * alimentavam a timeline, os alarmes e a aba Revisão — mas NENHUM deles
 * iniciava uma gravação. O dono descobriu do jeito ruim, depois de eu
 * recomendar três vezes "ligue a detecção por objeto" para uma opção que não
 * existia.
 *
 * Agora o gatilho depende do MODO DE GRAVAÇÃO da câmera:
 *
 *   motion  — grava com MOTION_DETECTED (o comportamento de sempre). Movimento
 *             é um sinal burro: sombra, folha, chuva e luz mudando disparam.
 *   object  — grava com OBJETO CONFIRMADO (pessoa/veículo). Sombra e folha não
 *             são pessoa, então param de gerar arquivo. Custa YOLO ligado
 *             naquela câmera (ver escopo-de-objeto.helper).
 *
 * A escolha é do operador porque o compromisso é dele: `motion` grava demais e
 * nunca perde nada; `object` grava pouco e depende do modelo reconhecer o que
 * passou. Numa cerca vazia à noite, `object` é o certo; num corredor onde
 * qualquer coisa importa, `motion`.
 */

/** Classes que iniciam gravação no modo `object`. */
export const CLASSES_QUE_GRAVAM = new Set([
  'person',
  'bicycle',
  'car',
  'motorcycle',
  'bus',
  'truck',
]);

export type EntradaDeGatilho = {
  /** Tipo do evento recebido (MOTION_DETECTED, OBJECT_DETECTED, ...). */
  tipo: string;
  /** `recordingMode` da câmera. */
  modoDeGravacao: string | null | undefined;
  /** `label` do metadata (a classe detectada), quando houver. */
  rotulo?: unknown;
};

/**
 * Este evento deve INICIAR/PROLONGAR uma gravação nesta câmera?
 *
 * Função pura de propósito: é a regra mais cara de errar do sistema. Um falso
 * negativo aqui é gravação que não existe quando alguém precisa dela.
 */
export function eventoDeveGravar(entrada: EntradaDeGatilho): boolean {
  const modo = String(entrada.modoDeGravacao ?? '');

  if (modo === 'object') {
    // No modo objeto, movimento NÃO grava — é justamente o que o operador
    // pediu para parar. Aceitar os dois tornaria o modo decorativo.
    if (entrada.tipo !== 'OBJECT_DETECTED') return false;
    const rotulo = String(entrada.rotulo ?? '').trim().toLowerCase();
    // Sem rótulo não dá para afirmar que é pessoa/veículo. Grava assim mesmo:
    // na dúvida, um sistema de segurança guarda a imagem. O contrário —
    // descartar em silêncio — é o defeito que ninguém percebe até precisar.
    if (!rotulo) return true;
    return CLASSES_QUE_GRAVAM.has(rotulo);
  }

  // Demais modos seguem a regra histórica, intocada.
  return entrada.tipo === 'MOTION_DETECTED';
}

/**
 * A câmera está ARMADA? (a gravação nasce de um evento e para por post-roll)
 *
 * `motion` e `object` compartilham TODA a mecânica de gravação — ring de
 * pré-evento, post-roll, parada por inatividade, fail-safe do detector cego.
 * A única diferença é QUEM dispara (ver `eventoDeveGravar`).
 *
 * Existe como função porque a comparação literal `recordingMode === 'motion'`
 * estava espalhada por 10 pontos do backend. Ao acrescentar o modo `object`,
 * cada ponto esquecido vira um buraco silencioso: a câmera aceita o modo na
 * tela e não grava, ou grava e nunca para. Um nome só, um lugar só.
 */
export function modoArmado(recordingMode: string | null | undefined): boolean {
  const modo = String(recordingMode ?? '');
  return modo === 'motion' || modo === 'object';
}
