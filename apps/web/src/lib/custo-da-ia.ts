// Quanto custa, em processamento, deixar a IA ligada numa câmera.
//
// A tela dizia "a detecção de objeto é cara" e não dizia quanto. Sem número,
// escolher "Sempre ligado" é apostar — e quem aposta erra para os dois lados:
// liga tudo e derruba o servidor, ou não liga nada e paga por IA que não usa.
//
// O número aqui NÃO é chute. Sai de duas medidas que o serviço de IA já
// publica por câmera:
//
//   inferAvgMs      quanto tempo UMA inferência leva, em média
//   processFpsReal  quantas inferências por segundo estão de fato acontecendo
//
// O produto das duas é o tempo de CPU gasto por segundo de relógio, ou seja a
// fração de um núcleo ocupada:
//
//   40 ms por inferência × 3 inferências por segundo = 120 ms a cada 1000 ms
//                                                    = 12% de um núcleo
//
// É a mesma conta que se faz no papel para dimensionar servidor, e por ser
// derivada de medida ela acompanha a realidade da câmera: cena movimentada
// infere mais vezes e custa mais, e o número mostra isso sozinho.

export type MedidaDeCusto = {
  inferAvgMs?: number | null;
  processFpsReal?: number | null;
};

/**
 * Fração de UM núcleo ocupada por esta câmera. `null` quando não há medida —
 * e `null` é resposta legítima: inventar número para câmera que nunca rodou
 * seria pior que admitir que ainda não se sabe.
 */
export function custoEmNucleos(medida: MedidaDeCusto | null | undefined): number | null {
  const ms = Number(medida?.inferAvgMs);
  const fps = Number(medida?.processFpsReal);
  if (!Number.isFinite(ms) || !Number.isFinite(fps)) return null;
  if (ms <= 0 || fps <= 0) return null;
  const fracao = (ms * fps) / 1000;
  // Teto de sanidade: acima de 8 núcleos por câmera a medida está corrompida
  // (relógio do container, contador reiniciado). Devolver o absurdo faria a
  // tela anunciar "1400% de um núcleo" com cara de fato.
  if (!Number.isFinite(fracao) || fracao <= 0 || fracao > 8) return null;
  return fracao;
}

/** 0.12 → "12% de um núcleo". 1.8 → "1,8 núcleos". */
export function formatarCusto(nucleos: number | null): string | null {
  if (nucleos === null || !Number.isFinite(nucleos) || nucleos <= 0) return null;
  if (nucleos < 1) return `${Math.round(nucleos * 100)}% de um núcleo`;
  return `${nucleos.toFixed(1).replace('.', ',')} núcleos`;
}

/**
 * Custo TÍPICO da instalação, para estimar o que uma câmera parada vai custar
 * se for ligada.
 *
 * Mediana, não média: uma câmera com medida corrompida ou uma cena
 * excepcionalmente movimentada puxaria a média e faria a estimativa mentir para
 * todas as outras.
 */
export function custoTipico(medidas: Array<MedidaDeCusto | null | undefined>): number | null {
  const valores = medidas
    .map((m) => custoEmNucleos(m))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  if (!valores.length) return null;
  const meio = Math.floor(valores.length / 2);
  return valores.length % 2 === 1 ? valores[meio] : (valores[meio - 1] + valores[meio]) / 2;
}

/** Soma do que está ligado agora. */
export function custoTotal(medidas: Array<MedidaDeCusto | null | undefined>): number | null {
  const valores = medidas.map((m) => custoEmNucleos(m)).filter((v): v is number => v !== null);
  if (!valores.length) return null;
  return valores.reduce((soma, v) => soma + v, 0);
}

/**
 * A frase que a tela mostra por câmera. Separa MEDIDO de ESTIMADO, porque as
 * duas coisas pedem confiança diferente de quem lê: um número medido justifica
 * uma decisão, um número estimado justifica uma tentativa.
 */
export function descreverCusto(input: {
  medida?: MedidaDeCusto | null;
  tipicoDaInstalacao?: number | null;
  rodando?: boolean;
}): { texto: string; medido: boolean } | null {
  const proprio = custoEmNucleos(input.medida);
  if (proprio !== null && input.rodando) {
    const texto = formatarCusto(proprio);
    return texto ? { texto: `Consome ${texto}`, medido: true } : null;
  }
  const tipico = input.tipicoDaInstalacao ?? null;
  const texto = formatarCusto(tipico);
  if (!texto) return null;
  return { texto: `Deve consumir cerca de ${texto}`, medido: false };
}
