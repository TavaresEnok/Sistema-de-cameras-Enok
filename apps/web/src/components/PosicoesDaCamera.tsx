import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, MapPin, Plus, Trash2 } from 'lucide-react';
import { getApiBaseUrl } from '../lib/api-base';
import { useAuthStore } from '../store/authStore';

/**
 * POSIÇÕES GRAVADAS — o atalho que faltava no PTZ.
 *
 * Até aqui o controle só sabia empurrar a câmera para os lados, que é a forma
 * mais lenta de chegar a um lugar que a câmera já sabe alcançar sozinha. As
 * posições costumam JÁ existir no equipamento: o instalador as grava no painel
 * da câmera ao apontar a dome ("portão", "doca", "estacionamento"). Nenhuma
 * tela daqui as mostrava.
 *
 * Chamado de "posições" e não de "presets" porque a tela é para o operador —
 * o mesmo motivo pelo qual o vocabulário da IA foi reescrito (§10 dos padrões
 * de interface).
 */

type Posicao = { token: string; nome: string };

export function PosicoesDaCamera({
  cameraId,
  podeGravar,
  desabilitado,
  aoIr,
}: {
  cameraId: string;
  /** Gravar e apagar mexem no equipamento; só quem administra a câmera vê. */
  podeGravar: boolean;
  desabilitado: boolean;
  aoIr?: (nome: string) => void;
}) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [posicoes, setPosicoes] = useState<Posicao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [indo, setIndo] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const [nomeNovo, setNomeNovo] = useState('');
  // Confirmação em duas etapas, e não caixa nativa do navegador: ela
  // ignora o tema, não prende o foco e não fecha no Esc (regra da
  // auditoria de front-end, com teste que barra `window.confirm`).
  const [confirmandoApagar, setConfirmandoApagar] = useState<string | null>(null);

  const cabecalho = { Authorization: `Bearer ${accessToken}` };

  const carregar = useCallback(async () => {
    if (!cameraId || !accessToken) return;
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`${getApiBaseUrl()}/ptz/${cameraId}/presets`, { headers: cabecalho });
      const d = await r.json();
      setPosicoes(Array.isArray(d?.presets) ? d.presets : []);
      // Erro do equipamento é diferente de "não há posições": a primeira pede
      // conserto, a segunda pede que alguém grave a primeira.
      if (d?.status === 'error') setErro(d.message ?? 'A câmera não respondeu.');
    } catch {
      setErro('Não consegui falar com o servidor.');
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, accessToken]);

  useEffect(() => { void carregar(); }, [carregar]);

  const ir = async (p: Posicao) => {
    setIndo(p.token);
    setErro(null);
    try {
      const r = await fetch(`${getApiBaseUrl()}/ptz/${cameraId}/presets/${encodeURIComponent(p.token)}/goto`, {
        method: 'POST',
        headers: { ...cabecalho, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (d?.status !== 'ok') throw new Error(d?.message ?? 'A câmera recusou o comando.');
      aoIr?.(p.nome);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao mover.');
    } finally {
      setIndo(null);
    }
  };

  const gravar = async () => {
    const nome = nomeNovo.trim();
    if (!nome) return;
    setGravando(true);
    setErro(null);
    try {
      const r = await fetch(`${getApiBaseUrl()}/ptz/${cameraId}/presets`, {
        method: 'POST',
        headers: { ...cabecalho, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nome }),
      });
      const d = await r.json();
      if (d?.status !== 'ok') throw new Error(d?.message ?? 'A câmera recusou gravar.');
      setNomeNovo('');
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao gravar.');
    } finally {
      setGravando(false);
    }
  };

  const apagar = async (p: Posicao) => {
    setConfirmandoApagar(null);
    setErro(null);
    try {
      const r = await fetch(`${getApiBaseUrl()}/ptz/${cameraId}/presets/${encodeURIComponent(p.token)}/remove`, {
        method: 'POST',
        headers: cabecalho,
      });
      const d = await r.json();
      if (d?.status !== 'ok') throw new Error(d?.message ?? 'A câmera recusou apagar.');
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao apagar.');
    }
  };

  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">
        <MapPin className="h-3.5 w-3.5" />
        Posições gravadas
      </div>

      {carregando ? (
        <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          Perguntando à câmera…
        </div>
      ) : posicoes.length === 0 ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          {erro
            ? 'Não consegui ler as posições desta câmera.'
            : 'Esta câmera não tem posições gravadas. Aponte-a para onde quiser e grave abaixo.'}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {posicoes.map((p) => (
            <div key={p.token} className="group relative">
              <button
                type="button"
                onClick={() => void ir(p)}
                disabled={desabilitado || indo !== null}
                title={`Ir para ${p.nome}`}
                className="inline-flex h-9 max-w-[14rem] items-center gap-2 truncate rounded-xl border border-border px-3 text-xs transition-colors hover:bg-[hsl(var(--accent))] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {indo === p.token ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <MapPin className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{p.nome}</span>
              </button>
              {podeGravar && (
                <button
                  type="button"
                  onClick={() => setConfirmandoApagar(p.token)}
                  title={`Apagar a posição ${p.nome}`}
                  aria-label={`Apagar a posição ${p.nome}`}
                  className="absolute -right-1.5 -top-1.5 hidden rounded-full border border-border bg-[hsl(var(--background))] p-0.5 text-[hsl(var(--muted-foreground))] hover:text-red-500 group-hover:block"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {confirmandoApagar && (
        <div role="alertdialog" aria-modal="true" className="mt-3 rounded-lg border border-[hsl(var(--destructive)_/_0.35)] bg-[hsl(var(--destructive)_/_0.06)] p-3">
          <p className="text-xs font-medium text-[hsl(var(--destructive))]">
            Apagar &quot;{posicoes.find((p) => p.token === confirmandoApagar)?.nome}&quot; da câmera?
          </p>
          <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
            A posição é apagada no próprio equipamento. Não dá para desfazer daqui.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setConfirmandoApagar(null)} className="h-8 rounded-lg border border-border px-3 text-xs hover:bg-[hsl(var(--accent))]">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                const alvo = posicoes.find((p) => p.token === confirmandoApagar);
                if (alvo) void apagar(alvo);
              }}
              className="h-8 rounded-lg bg-[hsl(var(--destructive))] px-3 text-xs text-white hover:opacity-90"
            >
              Apagar
            </button>
          </div>
        </div>
      )}

      {podeGravar && (
        <div className="mt-3 flex items-center gap-2">
          <input
            value={nomeNovo}
            onChange={(e) => setNomeNovo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void gravar(); }}
            placeholder="Nome da posição atual (ex.: Portão)"
            className="h-9 flex-1 rounded-xl border border-border bg-transparent px-3 text-xs outline-none placeholder:text-[hsl(var(--muted-foreground))]"
          />
          <button
            type="button"
            onClick={() => void gravar()}
            disabled={!nomeNovo.trim() || gravando || desabilitado}
            title="Gravar onde a câmera está apontando agora"
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-border px-3 text-xs transition-colors hover:bg-[hsl(var(--accent))] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {gravando ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Gravar aqui
          </button>
        </div>
      )}

      {erro && posicoes.length > 0 && (
        <p className="mt-2 text-xs text-red-500">{erro}</p>
      )}
    </div>
  );
}
