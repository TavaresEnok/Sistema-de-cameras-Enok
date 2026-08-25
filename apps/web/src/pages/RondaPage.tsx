import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock, LoaderCircle, Pause, Play, Plus, Trash2, X } from 'lucide-react';
import { getApiBaseUrl } from '../lib/api-base';
import { useAuthStore } from '../store/authStore';
import { SavedLayout, useVmsDataStore } from '../store/vmsDataStore';
import { LiveStreamPlayer } from '../components/LiveStreamPlayer';
import { paradaNoInstante, proximaParada, type Parada } from '../lib/ronda-rotacao';

/**
 * RONDA — o mural passa de um mosaico para outro, sozinho.
 *
 * Substitui o antigo "Modo Mural", que apenas ligava o mural do /live e
 * redirecionava para lá: era um item de menu que não levava a lugar nenhum
 * próprio.
 *
 * O nome é o do ofício: o vigia faz a RONDA, passando de ponto em ponto. Cada
 * parada tem seu tempo porque o portão merece mais que o corredor.
 *
 * DUAS DECISÕES DE TELA
 * ---------------------
 * · Os mosaicos são os MESMOS do /live. Manter uma segunda lista aqui faria o
 *   operador montar tudo duas vezes e as duas divergirem no primeiro ajuste.
 * · Ao trocar de parada, os players NÃO são desmontados e remontados do zero
 *   quando a câmera se repete entre mosaicos — remontar faz a imagem piscar, e
 *   mural que pisca a cada troca cansa em minutos.
 */

type Ronda = {
  id: string;
  name: string;
  paradas: Parada[];
  duracaoDaVoltaSegundos: number;
};

const SEGUNDOS_SUGERIDOS = [10, 15, 30, 60, 120, 300];

export default function RondaPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const layouts = useVmsDataStore((s) => s.layouts) as SavedLayout[];
  const cameras = useVmsDataStore((s) => s.cameras);

  const [rondas, setRondas] = useState<Ronda[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Ronda | null>(null);
  const [rodando, setRodando] = useState<Ronda | null>(null);

  const cabecalho = useMemo(() => ({ Authorization: `Bearer ${accessToken}` }), [accessToken]);

  const carregar = useCallback(async () => {
    if (!accessToken) return;
    setCarregando(true);
    try {
      const r = await fetch(`${getApiBaseUrl()}/rondas`, { headers: cabecalho });
      const d = await r.json();
      setRondas(Array.isArray(d?.items) ? d.items : []);
      setErro(null);
    } catch {
      setErro('Não consegui carregar as rondas.');
    } finally {
      setCarregando(false);
    }
  }, [accessToken, cabecalho]);

  useEffect(() => { void carregar(); }, [carregar]);

  const salvar = async (ronda: Ronda) => {
    const novo = !ronda.id;
    const url = novo ? `${getApiBaseUrl()}/rondas` : `${getApiBaseUrl()}/rondas/${ronda.id}`;
    const r = await fetch(url, {
      method: novo ? 'POST' : 'PATCH',
      headers: { ...cabecalho, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: ronda.name, paradas: ronda.paradas }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setErro(d?.message ?? 'Não foi possível salvar.');
      return;
    }
    setEditando(null);
    setErro(null);
    await carregar();
  };

  const remover = async (id: string) => {
    await fetch(`${getApiBaseUrl()}/rondas/${id}`, { method: 'DELETE', headers: cabecalho });
    await carregar();
  };

  if (rodando) {
    return <MuralDaRonda ronda={rodando} layouts={layouts} cameras={cameras} onSair={() => setRodando(null)} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="page-hdr">
        <div>
          <p className="page-sub">
            O mural passa de um mosaico para outro sozinho. Cada parada tem seu tempo —
            o portão merece mais que o corredor.
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditando({ id: '', name: '', paradas: [], duracaoDaVoltaSegundos: 0 })}>
          <Plus className="h-3.5 w-3.5" /> Nova ronda
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {erro && (
          <div role="alert" className="mb-3 rounded-lg border border-[hsl(var(--destructive)_/_0.35)] bg-[hsl(var(--destructive)_/_0.08)] px-3 py-2 text-xs text-[hsl(var(--destructive))]">
            {erro}
          </div>
        )}

        {carregando ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : rondas.length === 0 ? (
          <div className="ops-card mx-auto max-w-lg p-8 text-center">
            <Clock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <h2 className="text-[15px] font-semibold">Nenhuma ronda montada</h2>
            <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-muted-foreground">
              Uma ronda é uma sequência de mosaicos que o mural exibe em rodízio. Use os
              mesmos mosaicos que você já salvou em Ao Vivo e defina quanto tempo cada um
              fica na tela.
            </p>
            {layouts.length === 0 && (
              <p className="mt-3 text-[11px] text-amber-600 dark:text-amber-400">
                Você ainda não tem mosaicos salvos. Monte um em Ao Vivo primeiro.
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rondas.map((r) => (
              <article key={r.id} className="ops-card flex flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[14px] font-semibold">{r.name}</h3>
                  <button type="button" aria-label={`Apagar ${r.name}`} className="text-muted-foreground hover:text-[hsl(var(--destructive))]" onClick={() => void remover(r.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="text-[11.5px] text-muted-foreground">
                  {r.paradas.length} parada{r.paradas.length === 1 ? '' : 's'} · volta de {formatarDuracao(r.duracaoDaVoltaSegundos)}
                </p>
                <div className="mt-1 flex gap-2">
                  <button type="button" className="btn btn-primary btn-sm flex-1" onClick={() => setRodando(r)}>
                    <Play className="h-3.5 w-3.5" /> Iniciar
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditando(r)}>
                    Editar
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {editando && (
        <EditorDaRonda
          ronda={editando}
          layouts={layouts}
          onCancelar={() => { setEditando(null); setErro(null); }}
          onSalvar={salvar}
        />
      )}
    </div>
  );
}

function formatarDuracao(segundos: number): string {
  if (segundos < 60) return `${segundos}s`;
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return s ? `${m}min ${s}s` : `${m}min`;
}

/** Montagem da ronda: escolher mosaicos, ordenar, dar tempo a cada um. */
function EditorDaRonda({
  ronda, layouts, onCancelar, onSalvar,
}: {
  ronda: Ronda;
  layouts: SavedLayout[];
  onCancelar: () => void;
  onSalvar: (r: Ronda) => void | Promise<void>;
}) {
  const [nome, setNome] = useState(ronda.name);
  const [paradas, setParadas] = useState<Parada[]>(ronda.paradas);

  const nomeDoLayout = (id: string) => layouts.find((l) => l.id === id)?.name ?? '(mosaico apagado)';
  const total = paradas.reduce((s, p) => s + p.segundos, 0);

  const acrescentar = (layoutId: string) => {
    // O mesmo mosaico duas vezes SEGUIDAS não muda nada na tela — o servidor
    // recusa, e aqui a gente evita o operador chegar até lá.
    if (paradas.length && paradas[paradas.length - 1].layoutId === layoutId) return;
    setParadas([...paradas, { layoutId, segundos: 30 }]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="ops-card flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-[15px] font-semibold">{ronda.id ? 'Editar ronda' : 'Nova ronda'}</h2>
          <button type="button" onClick={onCancelar} aria-label="Fechar"><X className="h-4 w-4" /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground" htmlFor="ronda-nome">Nome</label>
            <input id="ronda-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ronda noturna" className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm" />
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Acrescentar mosaico</p>
            {layouts.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum mosaico salvo. Monte um em Ao Vivo primeiro.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {layouts.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => acrescentar(l.id)}
                    disabled={paradas.length > 0 && paradas[paradas.length - 1].layoutId === l.id}
                    title={paradas.length > 0 && paradas[paradas.length - 1].layoutId === l.id ? 'Já é a última parada — repetir seguido não muda a tela' : undefined}
                    className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-[hsl(var(--accent))] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    + {l.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Paradas, em ordem</p>
              {paradas.length > 0 && <p className="text-[11px] text-muted-foreground">volta de {formatarDuracao(total)}</p>}
            </div>
            {paradas.length === 0 ? (
              <p className="text-xs text-muted-foreground">Escolha ao menos um mosaico acima.</p>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {paradas.map((p, i) => (
                  <li key={`${p.layoutId}-${i}`} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                    <span className="w-5 shrink-0 text-center text-[11px] text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{nomeDoLayout(p.layoutId)}</span>
                    <select
                      value={p.segundos}
                      onChange={(e) => setParadas(paradas.map((x, j) => (j === i ? { ...x, segundos: Number(e.target.value) } : x)))}
                      className="h-8 shrink-0 rounded-lg border border-border bg-background px-2 text-xs"
                      aria-label={`Tempo da parada ${i + 1}`}
                    >
                      {SEGUNDOS_SUGERIDOS.map((s) => <option key={s} value={s}>{formatarDuracao(s)}</option>)}
                    </select>
                    <button type="button" aria-label={`Remover parada ${i + 1}`} className="shrink-0 text-muted-foreground hover:text-[hsl(var(--destructive))]" onClick={() => setParadas(paradas.filter((_, j) => j !== i))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancelar}>Cancelar</button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!nome.trim() || paradas.length === 0}
            onClick={() => void onSalvar({ ...ronda, name: nome.trim(), paradas })}
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

/** O mural em si: tela cheia, trocando de mosaico sozinho. */
function MuralDaRonda({
  ronda, layouts, cameras, onSair,
}: {
  ronda: Ronda;
  layouts: SavedLayout[];
  cameras: { id: string; name: string }[];
  onSair: () => void;
}) {
  const [indice, setIndice] = useState(0);
  const [pausado, setPausado] = useState(false);
  const [restante, setRestante] = useState(ronda.paradas[0]?.segundos ?? 30);
  const inicioRef = useRef<number>(Date.now());

  // A posição é calculada pelo TEMPO DECORRIDO, não por contagem de trocas.
  // Assim a aba que ficou em segundo plano — onde o navegador estrangula o
  // temporizador — volta na parada certa em vez de ficar para trás.
  useEffect(() => {
    if (pausado) return;
    const t = setInterval(() => {
      const decorrido = (Date.now() - inicioRef.current) / 1000;
      const pos = paradaNoInstante(ronda.paradas, decorrido);
      setIndice(pos.indice);
      setRestante(Math.max(0, Math.ceil((ronda.paradas[pos.indice]?.segundos ?? 0) - pos.segundosNaParada)));
    }, 500);
    return () => clearInterval(t);
  }, [pausado, ronda.paradas]);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSair();
      if (e.key === ' ') { e.preventDefault(); setPausado((p) => !p); }
      if (e.key === 'ArrowRight') {
        const proximo = proximaParada(indice, ronda.paradas.length);
        setIndice(proximo);
        // Reposiciona o relógio para a parada escolhida continuar do começo.
        const antes = ronda.paradas.slice(0, proximo).reduce((s, p) => s + p.segundos, 0);
        inicioRef.current = Date.now() - antes * 1000;
      }
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [indice, onSair, ronda.paradas]);

  const parada = ronda.paradas[indice];
  const layout = layouts.find((l) => l.id === parada?.layoutId);
  const idsDaTela = (layout?.cameraIds ?? []).filter(Boolean) as string[];
  const colunas = Math.ceil(Math.sqrt(Math.max(1, idsDaTela.length)));

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex shrink-0 items-center gap-3 bg-black/80 px-4 py-2 text-white">
        <span className="text-sm font-semibold">{ronda.name}</span>
        <span className="text-xs opacity-70">
          {layout?.name ?? '(mosaico apagado)'} · parada {indice + 1} de {ronda.paradas.length}
        </span>
        <span className="ml-auto font-mono text-xs tabular-nums opacity-80">{restante}s</span>
        <button type="button" onClick={() => setPausado((p) => !p)} aria-label={pausado ? 'Retomar' : 'Pausar'} className="rounded p-1 hover:bg-white/10">
          {pausado ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </button>
        <button type="button" onClick={onSair} aria-label="Sair da ronda" className="rounded p-1 hover:bg-white/10">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid min-h-0 flex-1 gap-0.5 p-0.5" style={{ gridTemplateColumns: `repeat(${colunas}, minmax(0, 1fr))` }}>
        {idsDaTela.length === 0 ? (
          <div className="flex items-center justify-center text-sm text-white/60">
            Este mosaico não tem câmeras.
          </div>
        ) : (
          idsDaTela.map((id) => {
            const cam = cameras.find((c) => c.id === id);
            return (
              <div key={id} className="relative min-h-0 bg-black">
                <LiveStreamPlayer cameraId={id} cameraName={cam?.name ?? ''} liveViewMode="grid" />
              </div>
            );
          })
        )}
      </div>

      <p className="shrink-0 bg-black/80 px-4 py-1 text-[10.5px] text-white/50">
        Espaço pausa · seta direita pula para a próxima · Esc sai
      </p>
    </div>
  );
}
