/**
 * RONDA NO CELULAR — a mesma ronda do mural, no bolso do vigia.
 *
 * O servidor já marca quais rondas devem aparecer no app (`showOnMobile`), e
 * até 16/09/2026 nada no aplicativo lia esse campo: o administrador ligava a
 * chave e não acontecia nada. Este módulo é a regra que faltava.
 *
 * Uma ronda é uma lista de PARADAS. Cada parada é um mosaico e o tempo que ele
 * fica na tela — o tempo é POR PARADA, de propósito: o portão não precisa do
 * mesmo tempo de tela que o estacionamento.
 *
 * Puro: sem relógio, sem tela, sem rede. O que decide o que aparece é testável
 * sem subir o app, porque errar aqui deixa o vigia olhando uma imagem parada
 * achando que está vendo tudo — o pior defeito possível numa ronda, já que não
 * parece defeito.
 *
 * Os limites de tempo são os MESMOS do servidor (rondas/helpers/ronda.helper.ts).
 * Divergir criaria uma ronda que roda diferente no celular e no mural.
 */

export type ParadaDaRonda = { layoutId: string; segundos: number };

export type RondaDoApp = {
  id: string;
  name: string;
  paradas: ParadaDaRonda[];
  active: boolean;
  showOnMobile: boolean;
  duracaoDaVoltaSegundos?: number;
};

export type MosaicoDoApp = {
  id: string;
  name: string;
  /** Posições do mosaico: `null` é quadro vazio (ou câmera que não posso ver). */
  cameraIds: Array<string | null>;
};

/** Menos que isto não dá tempo de o vídeo aparecer — a tela piscaria em vão. */
export const MIN_SEGUNDOS = 5;
/** Mais que isto não é ronda, é mosaico fixo. */
export const MAX_SEGUNDOS = 3600;
export const SEGUNDOS_PADRAO = 30;

/** Tempo da parada dentro dos limites; ausente ou inválido vira o padrão. */
export function segundosDaParada(parada: { segundos?: unknown } | null | undefined): number {
  const cru = parada?.segundos;
  // `Number(null)` é 0 em JavaScript: sem esta guarda, tempo ausente viraria
  // zero e o mosaico passaria voando.
  if (cru === null || cru === undefined || String(cru).trim() === '') return SEGUNDOS_PADRAO;
  const n = Number(cru);
  if (!Number.isFinite(n)) return SEGUNDOS_PADRAO;
  return Math.min(MAX_SEGUNDOS, Math.max(MIN_SEGUNDOS, Math.round(n)));
}

/**
 * As câmeras que esta parada mostra.
 *
 * Quadro vazio e câmera que o usuário não pode ver saem da lista — no celular
 * não há grade fixa para preservar, e um quadro preto só ocuparia a tela
 * pequena. Repetida na mesma parada aparece uma vez só.
 */
export function camerasDaParada(
  parada: ParadaDaRonda | null | undefined,
  mosaicos: MosaicoDoApp[],
  camerasVisiveis: Iterable<string>,
): string[] {
  const mosaico = mosaicos.find((m) => m.id === parada?.layoutId);
  if (!mosaico) return [];
  const permitidas = new Set(camerasVisiveis);
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const id of mosaico.cameraIds ?? []) {
    if (!id || vistas.has(id) || !permitidas.has(id)) continue;
    vistas.add(id);
    saida.push(id);
  }
  return saida;
}

/**
 * As paradas que REALMENTE têm o que mostrar.
 *
 * Mosaico apagado ou sem nenhuma câmera visível é pulado, e não vira tela preta
 * no meio da volta. É a mesma decisão tomada na ronda do mural.
 */
export function paradasUteis(
  ronda: RondaDoApp | null | undefined,
  mosaicos: MosaicoDoApp[],
  camerasVisiveis: Iterable<string>,
): ParadaDaRonda[] {
  const permitidas = [...camerasVisiveis];
  return (ronda?.paradas ?? []).filter((p) => camerasDaParada(p, mosaicos, permitidas).length > 0);
}

/**
 * As rondas que o app deve oferecer.
 *
 * Três condições, todas do servidor: estar ativa, estar marcada para o celular
 * e sobrar pelo menos uma parada com imagem. Rondas que não passam ficam de
 * fora da lista em vez de aparecerem e não rodarem.
 */
export function rondasDoCelular(
  rondas: RondaDoApp[],
  mosaicos: MosaicoDoApp[],
  camerasVisiveis: Iterable<string>,
): RondaDoApp[] {
  const permitidas = [...camerasVisiveis];
  return (rondas ?? []).filter(
    (r) => r?.active && r?.showOnMobile && paradasUteis(r, mosaicos, permitidas).length > 0,
  );
}

/** Próxima parada, voltando ao começo no fim da volta. */
export function proximaParada(indiceAtual: number, total: number): number {
  if (total <= 0) return 0;
  const seguinte = indiceAtual + 1;
  return seguinte >= total ? 0 : seguinte;
}

/** Quanto tempo leva uma volta inteira (para a tela dizer antes de começar). */
export function duracaoDaVolta(paradas: ParadaDaRonda[]): number {
  return (paradas ?? []).reduce((total, p) => total + segundosDaParada(p), 0);
}
