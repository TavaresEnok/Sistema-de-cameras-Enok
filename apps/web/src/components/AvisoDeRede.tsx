import { useEffect, useMemo } from 'react';
import { WifiOff, Wifi, ServerCrash, X } from 'lucide-react';
import { useRedeStore, calcularDiagnostico, contarPlayers } from '@/store/redeStore';
import { getApiBaseUrl } from '@/lib/api-base';

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
async function medirRtt(): Promise<number | null> {
  const inicio = performance.now();
  const abort = new AbortController();
  const timer = window.setTimeout(() => abort.abort(), TIMEOUT_SONDA_MS);
  try {
    // cache: 'no-store' — sem isso o navegador serviria do cache e mediríamos
    // 0 ms para uma rede que está morrendo.
    const r = await fetch(`${API_URL}/health`, { signal: abort.signal, cache: 'no-store' });
    if (!r.ok) return null;
    return performance.now() - inicio;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export function AvisoDeRede() {
  // Cada seletor devolve um valor PRIMITIVO (ou uma referência estável, no caso
  // de `players`). Selecionar um objeto calculado aqui faria o zustand ver
  // "mudou" a cada render e entrar em loop infinito — ver o aviso em
  // calcularDiagnostico(). O cálculo fica no useMemo abaixo.
  const players = useRedeStore((s) => s.players);
  const apiRttMs = useRedeStore((s) => s.apiRttMs);
  const apiFalhasSeguidas = useRedeStore((s) => s.apiFalhasSeguidas);
  const online = useRedeStore((s) => s.online);
  const nivelDispensado = useRedeStore((s) => s.nivelDispensado);
  const registrarAmostraApi = useRedeStore((s) => s.registrarAmostraApi);
  const definirOnline = useRedeStore((s) => s.definirOnline);
  const dispensarAviso = useRedeStore((s) => s.dispensarAviso);

  const diagnostico = useMemo(
    () => calcularDiagnostico(
      { online, apiRttMs, apiFalhasSeguidas, ...contarPlayers(players) },
      nivelDispensado,
    ),
    [online, apiRttMs, apiFalhasSeguidas, players, nivelDispensado],
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
    const id = window.setInterval(() => void sondar(), INTERVALO_SONDA_MS);

    const online = () => { definirOnline(true); void sondar(); };
    const offline = () => definirOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', sondar);
    return () => {
      vivo = false;
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

  // Culpa da rede local = âmbar (o operador PODE agir). Problema do servidor =
  // vermelho (é conosco). Cores diferentes evitam que os dois casos, que pedem
  // ações opostas, virem a mesma faixa amarela genérica.
  const cor = diagnostico.culpaDaRedeLocal ? 'status-warning' : 'destructive';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="banner-qualidade-rede"
      data-nivel={diagnostico.nivel}
      className={`flex min-h-9 shrink-0 items-center gap-2 border-b border-[hsl(var(--${cor})_/_0.35)] bg-[hsl(var(--${cor})_/_0.10)] px-3 text-[11px] text-foreground sm:px-5`}
    >
      <Icone className={`h-3.5 w-3.5 shrink-0 text-[hsl(var(--${cor}))]`} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        <strong className="font-semibold">{diagnostico.titulo}</strong>
        <span className="text-[hsl(var(--muted-foreground))]"> · {diagnostico.detalhe}</span>
      </span>
      <button
        type="button"
        onClick={() => dispensarAviso(diagnostico.nivel)}
        aria-label="Dispensar aviso de conexão"
        className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-card hover:bg-accent"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}
