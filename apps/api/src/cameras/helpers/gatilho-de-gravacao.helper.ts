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
  /** bbox do objeto no espaço do quadro, quando houver. */
  bbox?: unknown;
  /** Dimensões do quadro em que a bbox foi medida. */
  frameWidth?: unknown;
  frameHeight?: unknown;
  /** `detectionZones` da câmera (para o modo objeto respeitar a área). */
  zonas?: unknown;
};

/**
 * O PONTO DE APOIO do objeto está dentro de alguma zona include?
 *
 * Usa o pé da caixa (centro da base), não o centro geométrico: uma pessoa cujo
 * corpo aparece sobre a zona mas que está ANDANDO NA RUA atrás dela tem o pé
 * fora — e é o pé que diz onde o objeto ESTÁ. Mesma escolha do tripwire.
 *
 * Sem zonas include, tudo conta (a câmera inteira é a área monitorada).
 * Geometria por ray casting, gêmea da usada no Python — divergência entre as
 * duas é o bug mais difícil de notar, então mantenha ambas triviais.
 */
export function objetoDentroDaAreaMonitorada(entrada: {
  bbox?: unknown;
  frameWidth?: unknown;
  frameHeight?: unknown;
  zonas?: unknown;
}): boolean {
  const zonas = Array.isArray(entrada.zonas) ? entrada.zonas : [];
  const includes = zonas.filter((z: any) => z?.kind === 'include' && Array.isArray(z.points) && z.points.length >= 3);
  if (!includes.length) return true; // sem área desenhada = câmera inteira

  const bbox = Array.isArray(entrada.bbox) ? entrada.bbox.map(Number) : null;
  const w = Number(entrada.frameWidth);
  const h = Number(entrada.frameHeight);
  // Sem bbox ou sem escala não há como julgar a posição. GRAVA: na dúvida, um
  // sistema de segurança guarda a imagem (mesma regra do rótulo ausente).
  if (!bbox || bbox.length < 4 || !bbox.every(Number.isFinite)) return true;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return true;

  const px = ((bbox[0] + bbox[2]) / 2) / w; // centro da base…
  const py = bbox[3] / h;                    // …no pé da caixa

  for (const zona of includes) {
    const pts: number[][] = zona.points;
    let dentro = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = [Number(pts[i][0]), Number(pts[i][1])];
      const [xj, yj] = [Number(pts[j][0]), Number(pts[j][1])];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        dentro = !dentro;
      }
    }
    if (dentro) return true;
  }
  return false;
}

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
    // E o objeto precisa estar NA ÁREA monitorada. Sem este portão, um carro
    // na rua (fora da zona) gravaria do mesmo jeito — de novo a reclamação
    // "90% dos vídeos não têm nada na zona", só que com objeto no lugar de
    // movimento. Zona desenhada vale para o objeto também.
    if (!objetoDentroDaAreaMonitorada(entrada)) return false;
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
