import { create } from 'zustand';
import {
  avaliarQualidadeDeRede,
  mediana,
  registrarNoHistoricoDeRtt,
  type AmostraDeRtt,
  type DiagnosticoDeRede,
  type HistoricoDeRtt,
  type SinaisDeRede,
} from '@/lib/qualidade-de-rede';

// ── COLETOR DOS SINAIS DE REDE ──────────────────────────────────────────────
// Junta o que cada player de vídeo está vivendo com uma medição periódica da
// latência até a API, e entrega o diagnóstico pronto para a faixa de aviso.
// A decisão em si mora em lib/qualidade-de-rede.ts (pura e testada).

/**
 * O que um player relata. A distinção entre os dois modos de falha é o coração
 * do diagnóstico — ver o comentário grande em lib/qualidade-de-rede.ts:
 *  - 'sem-sinalizacao': o pedido de stream falhou (servidor recusou/não veio);
 *  - 'sem-midia':       a sessão ABRIU, mas a imagem não chega (caminho do vídeo).
 */
export type EstadoDoPlayer = 'ok' | 'sem-midia' | 'sem-sinalizacao';

type RedeState = {
  players: Record<string, EstadoDoPlayer>;
  apiRttMs: number | null;
  bordaRttMs: number | null;
  apiLentidaConfirmada: boolean;
  apiFalhasSeguidas: number;
  online: boolean;
  /** Quando o usuário fecha a faixa, some até a situação MUDAR de nível. */
  nivelDispensado: string | null;

  relatarPlayer: (id: string, estado: EstadoDoPlayer) => void;
  esquecerPlayer: (id: string) => void;
  registrarAmostraApi: (amostra: AmostraDeRtt | null) => void;
  definirOnline: (online: boolean) => void;
  dispensarAviso: (nivel: string) => void;
};

const HISTORICO_INICIAL: HistoricoDeRtt = {
  api: [],
  borda: [],
  lentasSeguidas: 0,
  saudaveisSeguidas: 0,
  lentidaConfirmada: false,
};

let historicoRtt = HISTORICO_INICIAL;

export const useRedeStore = create<RedeState>((set) => ({
  players: {},
  apiRttMs: null,
  bordaRttMs: null,
  apiLentidaConfirmada: false,
  apiFalhasSeguidas: 0,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  nivelDispensado: null,

  relatarPlayer: (id, estado) =>
    set((s) => (s.players[id] === estado ? s : { players: { ...s.players, [id]: estado } })),

  esquecerPlayer: (id) =>
    set((s) => {
      if (!(id in s.players)) return s;
      const players = { ...s.players };
      delete players[id];
      return { players };
    }),

  registrarAmostraApi: (amostra) =>
    set((s) => {
      historicoRtt = registrarNoHistoricoDeRtt(historicoRtt, amostra);
      return {
        // Uma falha isolada não apaga a última mediana válida nem parece uma
        // recuperação. Três falhas seguidas têm diagnóstico próprio.
        apiRttMs: mediana(historicoRtt.api),
        bordaRttMs: mediana(historicoRtt.borda),
        apiLentidaConfirmada: historicoRtt.lentidaConfirmada,
        // Uma amostra boa zera o contador; só falha SEGUIDA acumula. Assim um
        // soluço isolado de rede não vira alarme na cara do operador.
        apiFalhasSeguidas: amostra == null ? s.apiFalhasSeguidas + 1 : 0,
      };
    }),

  definirOnline: (online) => set({ online }),

  dispensarAviso: (nivel) => set({ nivelDispensado: nivel }),
}));

/** Conta os relatos dos players. Recebe o objeto cru para poder ser memoizado. */
export function contarPlayers(players: Record<string, EstadoDoPlayer>) {
  const estados = Object.values(players);
  return {
    streamsTotal: estados.length,
    streamsSemMidia: estados.filter((e) => e === 'sem-midia').length,
    streamsSemSinalizacao: estados.filter((e) => e === 'sem-sinalizacao').length,
  };
}

/**
 * Diagnóstico pronto, já respeitando o "não mostrar de novo" do usuário.
 *
 * ⚠️ NÃO use isto como seletor do zustand (`useRedeStore(diagnosticoVisivel)`).
 * Ele devolve um OBJETO NOVO a cada chamada; o zustand compara por identidade
 * (Object.is), conclui "mudou" sempre e entra em loop infinito de renderização
 * — React error #185, que derrubou a página inteira em produção quando esta
 * tela foi escrita. Selecione os campos primitivos e chame isto dentro de um
 * useMemo (é o que AvisoDeRede.tsx faz).
 */
export function calcularDiagnostico(
  sinais: SinaisDeRede,
  nivelDispensado: string | null,
): DiagnosticoDeRede | null {
  const d = avaliarQualidadeDeRede(sinais);
  if (d.nivel === 'ok') return null;
  if (nivelDispensado === d.nivel) return null;
  return d;
}
