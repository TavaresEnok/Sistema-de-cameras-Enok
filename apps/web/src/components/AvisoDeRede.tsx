import { useEffect, useMemo } from 'react';
import { WifiOff, Wifi, ServerCrash, X } from 'lucide-react';
import { useRedeStore, calcularDiagnostico, contarPlayers } from '@/store/redeStore';
import { getApiBaseUrl } from '@/lib/api-base';
import type { AmostraDeRtt } from '@/lib/qualidade-de-rede';

const API_URL = getApiBaseUrl();

// ── FAIXA "SUA CONEXÃO ESTÁ INSTÁVEL" ───────────────────────────────────────
// Pedido do dono: quando a internet DELE (ou do cliente) oscila, o sistema tem
// de dizer isso na tela — senão a culpa cai no DRAC. A regra de quem é a culpa
// mora em lib/qualidade-de-rede.ts, que só acusa a rede local quando o servidor
// está comprovadamente respondendo.

/** De quanto em quanto tempo medimos a ida-e-volta até a API. */
const INTERVALO_SONDA_MS = 15_000;
/** Acima disto a sonda conta como falha (e não como "muito lento"). */
const TIMEOUT_SONDA_MS = 8_000;

/**
 * Mede a latência do caminho de CONTROLE. Usa /health: é a rota mais barata
 * (não toca banco) — sondar de 15 em 15 s não pode custar nada ao servidor.
 */
async function medirUmaRota(url: string): Promise<number | null> {
  const inicio = performance.now();
  const abort = new AbortController();
  const timer = window.setTimeout(() => abort.abort(), TIMEOUT_SONDA_MS);
  try {
    // cache: 'no-store' — sem isso o navegador serviria do cache e mediríamos
    // 0 ms para uma rede que está morrendo.
    const r = await fetch(url, { signal: abort.signal, cache: 'no-store' });
    if (!r.ok) return null;
    return performance.now() - inicio;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Mede em paralelo a API e um arquivo estático do mesmo domínio. O segundo
 * caminho para no Nginx; ele permite distinguir API sobrecarregada de uma
 * lentidão que já existe antes de chegar à aplicação.
 */
async function medirRtt(): Promise<AmostraDeRtt | null> {
  const sufixo = `?_rede=${Date.now()}`;
  const [apiRttMs, bordaRttMs] = await Promise.all([
    medirUmaRota(`${API_URL}/health${sufixo}`),
    medirUmaRota(`${window.location.origin}/network-probe.txt${sufixo}`),
  ]);
  return apiRttMs == null ? null : { apiRttMs, bordaRttMs };
}

// Classes com a cor LITERAL — o Tailwind (JIT) só gera o que enxerga como texto
// no fonte; `hsl(var(--${cor}))` interpolado em runtime não seria gerado e a
// faixa sairia sem cor. Por isso cada variante é escrita por extenso.
const ESTILO = {
  // Rede local instável = âmbar. É o caso que o CLIENTE precisa enxergar (a
  // culpa não é do DRAC), então é o mais forte: fundo presente, texto na cor,
  // e o ícone pulsa para puxar o olho.
  'status-warning': {
    faixa: 'border-[hsl(var(--status-warning)_/_0.6)] bg-[hsl(var(--status-warning)_/_0.18)]',
    bolha: 'bg-[hsl(var(--status-warning)_/_0.22)]',
    ping: 'bg-[hsl(var(--status-warning)_/_0.5)]',
    titulo: 'text-[hsl(var(--status-warning))]',
  },
  // Problema do servidor = vermelho (é conosco).
  destructive: {
    faixa: 'border-[hsl(var(--destructive)_/_0.6)] bg-[hsl(var(--destructive)_/_0.18)]',
    bolha: 'bg-[hsl(var(--destructive)_/_0.22)]',
    ping: 'bg-[hsl(var(--destructive)_/_0.5)]',
    titulo: 'text-[hsl(var(--destructive))]',
  },
} as const;

export function AvisoDeRede() {
  // Cada seletor devolve um valor PRIMITIVO (ou uma referência estável, no caso
  // de `players`). Selecionar um objeto calculado aqui faria o zustand ver
  // "mudou" a cada render e entrar em loop infinito — ver o aviso em
  // calcularDiagnostico(). O cálculo fica no useMemo abaixo.
  const players = useRedeStore((s) => s.players);
  const apiRttMs = useRedeStore((s) => s.apiRttMs);
  const bordaRttMs = useRedeStore((s) => s.bordaRttMs);
  const apiLentidaConfirmada = useRedeStore((s) => s.apiLentidaConfirmada);
  const apiFalhasSeguidas = useRedeStore((s) => s.apiFalhasSeguidas);
  const online = useRedeStore((s) => s.online);
  const nivelDispensado = useRedeStore((s) => s.nivelDispensado);
  const registrarAmostraApi = useRedeStore((s) => s.registrarAmostraApi);
  const definirOnline = useRedeStore((s) => s.definirOnline);
  const dispensarAviso = useRedeStore((s) => s.dispensarAviso);

  const diagnostico = useMemo(
    () => calcularDiagnostico(
      {
        online,
        apiRttMs,
        bordaRttMs,
        apiLentidaConfirmada,
        apiFalhasSeguidas,
        ...contarPlayers(players),
      },
      nivelDispensado,
    ),
    [online, apiRttMs, bordaRttMs, apiLentidaConfirmada, apiFalhasSeguidas, players, nivelDispensado],
  );

  // Sonda periódica + eventos do navegador.
  useEffect(() => {
    let vivo = true;
    const sondar = async () => {
      // Aba oculta não mede: o navegador estrangula timers e fetch em segundo
      // plano, e a medição sairia artificialmente lenta — o que viraria um
      // "sua conexão está ruim" falso ao voltar para a aba.
      if (document.visibilityState === 'hidden') return;
      const rtt = await medirRtt();
      if (vivo) registrarAmostraApi(rtt);
    };
    void sondar();
    // Na abertura, três amostras rápidas dão um diagnóstico útil sem esperar
    // 30 segundos. Depois delas permanece apenas a cadência leve de 15 s.
    const iniciais = [
      window.setTimeout(() => void sondar(), 2_000),
      window.setTimeout(() => void sondar(), 5_000),
    ];
    const id = window.setInterval(() => void sondar(), INTERVALO_SONDA_MS);

    const online = () => { definirOnline(true); void sondar(); };
    const offline = () => definirOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', sondar);
    return () => {
      vivo = false;
      iniciais.forEach((timer) => window.clearTimeout(timer));
      window.clearInterval(id);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', sondar);
    };
  }, [definirOnline, registrarAmostraApi]);

  if (!diagnostico) return null;

  const Icone = diagnostico.nivel === 'offline'
    ? WifiOff
    : diagnostico.nivel === 'servidor'
      ? ServerCrash
      : Wifi;

  // Problema confirmado no servidor = vermelho (é conosco). Rede ou origem
  // ainda inconclusiva = âmbar, sem acusar o cliente antes de haver prova.
  const problemaDoServidor = diagnostico.nivel === 'servidor';
  const atencao = !problemaDoServidor;
  const estilo = ESTILO[problemaDoServidor ? 'destructive' : 'status-warning'];

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="banner-qualidade-rede"
      data-nivel={diagnostico.nivel}
      className={`flex shrink-0 items-center gap-2.5 border-y-2 px-3 py-2 sm:px-5 ${estilo.faixa}`}
    >
      {/* Bolha + pulso: um alerta que o cliente não perde de vista, em vez da
          faixa quase invisível de antes (fundo 10%, texto 11px, detalhe cinza). */}
      <span className={`relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${estilo.bolha}`}>
        {atencao && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full motion-reduce:hidden ${estilo.ping}`} aria-hidden="true" />
        )}
        <Icone className={`relative h-4 w-4 ${estilo.titulo}`} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <strong className={`text-[13px] font-bold ${estilo.titulo}`}>{diagnostico.titulo}</strong>
        <span className="text-[12px] text-foreground/90"> · {diagnostico.detalhe}</span>
      </span>
      <button
        type="button"
        onClick={() => dispensarAviso(diagnostico.nivel)}
        aria-label="Dispensar aviso de conexão"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-card hover:bg-accent"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
