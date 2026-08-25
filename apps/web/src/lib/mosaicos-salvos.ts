/**
 * OS MOSAICOS SALVOS — uma fonte só, para as duas telas.
 *
 * O defeito que isto corrige (25/08/2026): "as grids de live/ não está tão bem
 * sincronizadas com rondas".
 *
 * Havia duas listas com o mesmo nome e conteúdos diferentes:
 *
 *   · `vmsDataStore.layouts` — UM mosaico GERADO, chamado "Layout Atual", com
 *     TODAS as câmeras. Nunca foi a lista do operador;
 *   · os mosaicos que o operador salva em Ao Vivo, que vivem na API
 *     (`/live-layouts`) e têm cópia local para abrir rápido.
 *
 * A tela de Ronda lia a primeira. Resultado: ela oferecia um mosaico que o
 * operador nunca montou, com um identificador (`default-live-layout`) que NÃO
 * existe no banco — e o servidor, que valida a ronda contra os layouts reais,
 * recusaria na hora de salvar.
 *
 * A API é a fonte da verdade porque é contra ela que o servidor valida. A cópia
 * local serve para a tela abrir sem esperar a rede, e é substituída assim que a
 * resposta chega — nunca o contrário.
 */

export type MosaicoSalvo = {
  id: string;
  name: string;
  gridSize: string;
  cameraIds: string[];
  lastUsed?: string;
};

/** A MESMA chave que a tela Ao Vivo usa. Duas chaves seriam duas listas. */
export const CHAVE_LOCAL = 'drac.live.layouts.v1';

/** Aceita só o que dá para desenhar: grade no formato NxN e lista de câmeras. */
export function lerMosaicoDaApi(bruto: unknown): MosaicoSalvo | null {
  const l = bruto as { id?: unknown; name?: unknown; gridSize?: unknown; cameraIds?: unknown; lastUsedAt?: unknown };
  if (!l || typeof l.id !== 'string' || !l.id) return null;
  if (typeof l.gridSize !== 'string' || !/^[1-8]x[1-8]$/.test(l.gridSize)) return null;
  if (!Array.isArray(l.cameraIds)) return null;
  return {
    id: l.id,
    name: typeof l.name === 'string' && l.name.trim() ? l.name : 'Mosaico',
    gridSize: l.gridSize,
    cameraIds: l.cameraIds.map(String).filter(Boolean),
    lastUsed: typeof l.lastUsedAt === 'string' ? l.lastUsedAt : undefined,
  };
}

/** A cópia local, para a tela não abrir vazia enquanto a rede responde. */
export function lerCopiaLocal(): MosaicoSalvo[] {
  if (typeof window === 'undefined') return [];
  try {
    const cru = window.localStorage.getItem(CHAVE_LOCAL);
    if (!cru) return [];
    const lista = JSON.parse(cru);
    if (!Array.isArray(lista)) return [];
    return lista.filter(
      (m): m is MosaicoSalvo => Boolean(m && typeof m.id === 'string' && Array.isArray(m.cameraIds)),
    );
  } catch {
    return [];
  }
}

/**
 * Junta o que veio da API com a cópia local.
 *
 * A API MANDA: mosaico apagado em outro aparelho não pode ressuscitar porque
 * ainda estava no armazenamento deste navegador. A cópia local só preenche
 * enquanto a resposta não chega.
 */
export function preferirApi(daApi: MosaicoSalvo[], local: MosaicoSalvo[]): MosaicoSalvo[] {
  if (daApi.length) return daApi;
  return local;
}
