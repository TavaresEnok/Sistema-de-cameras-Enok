import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { AlertTriangle, Grid2X2, LoaderCircle, Radio, RefreshCw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { getApiBaseUrl } from '../lib/api-base';
import { useAuthStore } from '../store/authStore';
import { toast } from '../hooks/use-toast';
import {
  SeletorDeDestinatarios,
  type Destinatarios,
  type GrupoSimples,
  type PessoaSimples,
} from '../components/SeletorDeDestinatarios';

/**
 * MOSAICOS E RONDAS — a tela de quem ADMINISTRA.
 *
 * A outra metade da dupla: em "Ronda" o operador monta e roda o que é dele;
 * aqui o administrador vê o de todo mundo e ENTREGA.
 *
 * Pedido em 26/08/2026: num condomínio de dez pessoas, dez montavam o mesmo
 * mosaico da portaria porque não havia como um montar e passar aos outros.
 *
 * O QUE ESTA TELA NÃO FAZ
 * -----------------------
 * Entregar mosaico NÃO dá acesso a câmera. Quem recebe continua vendo apenas
 * as câmeras que já podia ver; as demais chegam como quadro apagado. Isso é
 * garantido no servidor, não aqui — tela nenhuma deve ser a última linha de
 * defesa de privacidade.
 */

const API_URL = getApiBaseUrl();

type Dono = { id: string; name: string; email: string };

type MosaicoAdmin = {
  id: string;
  name: string;
  gridSize: string;
  capacidade: number;
  cameras: number;
  active: boolean;
  showOnMobile: boolean;
  dono: Dono;
  destinatarios: { usuarios: PessoaSimples[]; grupos: GrupoSimples[] };
  usuariosAlcancados: number;
};

type RondaAdmin = {
  id: string;
  name: string;
  mosaicos: number;
  duracaoDaVoltaSegundos: number;
  active: boolean;
  showOnMobile: boolean;
  dono: Dono;
  destinatarios: { usuarios: PessoaSimples[]; grupos: GrupoSimples[] };
  usuariosAlcancados: number;
};

type Aba = 'mosaicos' | 'rondas';

/** "2 min 30 s" lê melhor que "150 s" numa coluna de tabela. */
function duracaoLegivel(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos <= 0) return '—';
  const min = Math.floor(segundos / 60);
  const seg = Math.round(segundos % 60);
  if (!min) return `${seg} s`;
  if (!seg) return `${min} min`;
  return `${min} min ${seg} s`;
}

export default function DistribuicaoPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [aba, setAba] = useState<Aba>('mosaicos');
  const [mosaicos, setMosaicos] = useState<MosaicoAdmin[]>([]);
  const [rondas, setRondas] = useState<RondaAdmin[]>([]);
  const [usuarios, setUsuarios] = useState<PessoaSimples[]>([]);
  const [grupos, setGrupos] = useState<GrupoSimples[]>([]);
  const [carregando, setCarregando] = useState(true);
  // Erro separado da lista vazia: "nenhum mosaico" e "não consegui perguntar"
  // são coisas diferentes, e confundi-las faz o administrador concluir que
  // ninguém montou nada quando na verdade a rede caiu.
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ tipo: Aba; id: string } | null>(null);
  const [rascunho, setRascunho] = useState<Destinatarios>({ usuarios: [], grupos: [] });
  const [rascunhoAtivo, setRascunhoAtivo] = useState(true);
  const [rascunhoNoApp, setRascunhoNoApp] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const client = useMemo(
    () =>
      axios.create({
        baseURL: API_URL,
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      }),
    [accessToken],
  );

  const carregar = useCallback(async () => {
    if (!accessToken) return;
    setCarregando(true);
    try {
      const [rMos, rRon, rUsu, rGru] = await Promise.all([
        client.get<MosaicoAdmin[]>('/live-layouts/administrados'),
        client.get<{ items: RondaAdmin[] }>('/rondas/administradas'),
        client.get<PessoaSimples[]>('/users'),
        client.get<GrupoSimples[]>('/camera-groups'),
      ]);
      setMosaicos(Array.isArray(rMos.data) ? rMos.data : []);
      setRondas(Array.isArray(rRon.data?.items) ? rRon.data.items : []);
      setUsuarios(Array.isArray(rUsu.data) ? rUsu.data : []);
      setGrupos(Array.isArray(rGru.data) ? rGru.data : []);
      setErro(null);
    } catch {
      setErro('Não consegui falar com o servidor. Nada foi perdido — os mosaicos e as rondas continuam salvos.');
    } finally {
      setCarregando(false);
    }
  }, [accessToken, client]);

  useEffect(() => { void carregar(); }, [carregar]);

  const alvo = useMemo(() => {
    if (!editando) return null;
    return editando.tipo === 'mosaicos'
      ? mosaicos.find((m) => m.id === editando.id) ?? null
      : rondas.find((r) => r.id === editando.id) ?? null;
  }, [editando, mosaicos, rondas]);

  const abrir = (tipo: Aba, item: MosaicoAdmin | RondaAdmin) => {
    setEditando({ tipo, id: item.id });
    setRascunho({
      usuarios: item.destinatarios.usuarios.map((u) => u.id),
      grupos: item.destinatarios.grupos.map((g) => g.id),
    });
    setRascunhoAtivo(item.active);
    setRascunhoNoApp(item.showOnMobile);
  };

  const salvar = async () => {
    if (!editando) return;
    setSalvando(true);
    try {
      const caminho = editando.tipo === 'mosaicos' ? 'live-layouts' : 'rondas';
      await client.patch(`/${caminho}/${editando.id}`, {
        destinatarios: rascunho,
        active: rascunhoAtivo,
        showOnMobile: rascunhoNoApp,
      });
      const quantos = rascunho.usuarios.length + rascunho.grupos.length;
      toast({
        title: 'Entrega salva',
        description: quantos
          ? `Vai para ${quantos} destinatário${quantos > 1 ? 's' : ''}.`
          : 'Sem destinatários: fica só com quem criou.',
      });
      setEditando(null);
      await carregar();
    } catch (e) {
      const msg = axios.isAxiosError(e) ? e.response?.data?.message : null;
      toast({
        title: 'Não foi possível salvar',
        description: typeof msg === 'string' ? msg : 'Tente de novo em instantes.',
        variant: 'destructive',
      });
    } finally {
      setSalvando(false);
    }
  };

  const lista = aba === 'mosaicos' ? mosaicos : rondas;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Mosaicos e rondas</h1>
            <p className="text-sm text-muted-foreground">
              Monte uma vez e entregue à equipe. Quem recebe usa; quem criou altera.
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => void carregar()} disabled={carregando}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', carregando && 'animate-spin')} />
            Atualizar
          </button>
        </header>

        <div className="flex gap-1 rounded-md border border-border p-1">
          {(
            [
              { id: 'mosaicos' as const, rotulo: 'Mosaicos', icone: Grid2X2, total: mosaicos.length },
              { id: 'rondas' as const, rotulo: 'Rondas', icone: Radio, total: rondas.length },
            ]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setAba(t.id)}
              aria-pressed={aba === t.id}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded px-3 py-2 text-sm font-medium transition-colors',
                aba === t.id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <t.icone className="h-4 w-4" />
              {t.rotulo}
              <Badge variant="secondary" className="text-[10px]">{t.total}</Badge>
            </button>
          ))}
        </div>

        {erro && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
            <span className="min-w-0 flex-1">{erro}</span>
            <Button size="sm" variant="secondary" onClick={() => void carregar()}>
              Tentar novamente
            </Button>
          </div>
        )}

        {carregando && !lista.length && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Carregando…
          </div>
        )}

        {!carregando && !erro && !lista.length && (
          <div className="rounded-md border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
            {aba === 'mosaicos'
              ? 'Ninguém montou mosaico ainda. Eles nascem em Ao Vivo ou na tela de Ronda.'
              : 'Nenhuma ronda montada ainda. Elas nascem na tela de Ronda.'}
          </div>
        )}

        {!!lista.length && (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Nome</th>
                  <th className="px-3 py-2 text-left font-medium">Criado por</th>
                  <th className="px-3 py-2 text-right font-medium tabular-nums">
                    {aba === 'mosaicos' ? 'Câmeras' : 'Mosaicos'}
                  </th>
                  <th className="px-3 py-2 text-right font-medium tabular-nums">
                    {aba === 'mosaicos' ? 'Quadros' : 'Volta'}
                  </th>
                  <th className="px-3 py-2 text-right font-medium tabular-nums">Recebem</th>
                  <th className="px-3 py-2 text-center font-medium">Ativo</th>
                  <th className="px-3 py-2 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {aba === 'mosaicos' &&
                  mosaicos.map((m) => (
                    <tr key={m.id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{m.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{m.dono?.name ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{m.cameras}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {m.gridSize} ({m.capacidade})
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3 opacity-60" />
                          {m.usuariosAlcancados}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant={m.active ? 'secondary' : 'outline'} className="text-[10px]">
                          {m.active ? 'Sim' : 'Não'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="secondary" onClick={() => abrir('mosaicos', m)}>
                          Entregar
                        </Button>
                      </td>
                    </tr>
                  ))}
                {aba === 'rondas' &&
                  rondas.map((r) => (
                    <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{r.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.dono?.name ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.mosaicos}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {duracaoLegivel(r.duracaoDaVoltaSegundos)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3 opacity-60" />
                          {r.usuariosAlcancados}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant={r.active ? 'secondary' : 'outline'} className="text-[10px]">
                          {r.active ? 'Sim' : 'Não'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="secondary" onClick={() => abrir('rondas', r)}>
                          Entregar
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Sheet open={!!editando} onOpenChange={(aberto) => !aberto && setEditando(null)}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="shrink-0 border-b border-border p-4">
            <SheetTitle>{alvo ? `Entregar “${alvo.name}”` : 'Entregar'}</SheetTitle>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            <p className="text-xs text-muted-foreground">
              Quem receber pode abrir e usar, mas não alterar. As câmeras que a pessoa não tem
              permissão de ver chegam como quadro apagado — entregar o mosaico não entrega a câmera.
            </p>

            <SeletorDeDestinatarios
              id="entrega"
              usuarios={usuarios}
              grupos={grupos}
              valor={rascunho}
              onChange={setRascunho}
            />

            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label htmlFor="entrega-ativo" className="text-sm">Ativo</Label>
                  <p className="text-xs text-muted-foreground">
                    Desligado, some da lista de quem recebeu — sem precisar apagar.
                  </p>
                </div>
                <Switch id="entrega-ativo" checked={rascunhoAtivo} onCheckedChange={setRascunhoAtivo} />
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <div className="min-w-0">
                  <Label htmlFor="entrega-app" className="text-sm">Aparece no aplicativo</Label>
                  <p className="text-xs text-muted-foreground">
                    Um mosaico de muitos quadros fica ilegível na tela do celular.
                  </p>
                </div>
                <Switch id="entrega-app" checked={rascunhoNoApp} onCheckedChange={setRascunhoNoApp} />
              </div>
            </div>
          </div>

          <SheetFooter className="shrink-0 gap-2 border-t border-border p-4">
            <Button variant="secondary" onClick={() => setEditando(null)} disabled={salvando}>
              Cancelar
            </Button>
            <Button onClick={() => void salvar()} disabled={salvando}>
              {salvando && <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Salvar entrega
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
