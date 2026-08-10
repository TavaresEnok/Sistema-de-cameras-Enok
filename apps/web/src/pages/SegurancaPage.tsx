import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { ExternalLink, ShieldAlert, Spline, SquareDashed, EyeOff, Plus } from 'lucide-react';
import { SeletorDeCamera } from '../components/SeletorDeCamera';
import { LiveStreamPlayer } from '../components/LiveStreamPlayer';
import { useAuthStore } from '../store/authStore';
import { useVmsDataStore } from '../store/vmsDataStore';

// ── PÁGINA DE SEGURANÇA — linha e zona de perímetro, por câmera ─────────────
//
// Irmã da página de PTZ. Mesma filosofia: esta tela AGREGA (mostra a frota e o
// que cada câmera tem de perímetro) e MANDA CONFIGURAR no editor que já existe
// no detalhe da câmera (aba "zones"), em vez de duplicar o editor de desenho.
//
// O que é cada coisa, para o operador não confundir:
//   · Linha       — um limite que não se atravessa (tripwire), com sentido.
//   · Monitorar   — área onde a detecção vale.
//   · Ignorar     — área que a detecção descarta (galho, rua movimentada).

type ResumoPerimetro = { linhas: number; monitorar: number; ignorar: number };

function resumir(zones: Array<{ kind: string }> | undefined): ResumoPerimetro {
  const r: ResumoPerimetro = { linhas: 0, monitorar: 0, ignorar: 0 };
  for (const z of zones ?? []) {
    if (z.kind === 'line') r.linhas += 1;
    else if (z.kind === 'include') r.monitorar += 1;
    else if (z.kind === 'exclude') r.ignorar += 1;
  }
  return r;
}

const temPerimetro = (r: ResumoPerimetro) => r.linhas + r.monitorar + r.ignorar > 0;

export default function SegurancaPage() {
  const [location, setLocation] = useLocation();
  const userRole = useAuthStore((state) => state.user?.role ?? 'viewer');
  const cameras = useVmsDataStore((state) => state.cameras);

  // Só câmeras ativas. Câmera desativada não grava nem detecta — não faz sentido
  // configurar perímetro nela.
  const lista = useMemo(
    () => cameras
      .filter((camera) => camera.enabled)
      .map((camera) => ({ camera, resumo: resumir(camera.detectionZones) }))
      .sort((a, b) =>
        // Quem já tem perímetro primeiro; depois online; depois nome.
        Number(temPerimetro(b.resumo)) - Number(temPerimetro(a.resumo))
        || Number(b.camera.isOnline) - Number(a.camera.isOnline)
        || a.camera.name.localeCompare(b.camera.name, 'pt-BR')),
    [cameras],
  );
  const camerasSelecionaveis = useMemo(() => lista.map((item) => item.camera), [lista]);

  const [selectedCamId, setSelectedCamId] = useState('');

  const requestedCameraId = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('cameraId');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  useEffect(() => {
    if (!lista.length) { setSelectedCamId(''); return; }
    if (requestedCameraId && lista.some((i) => i.camera.id === requestedCameraId)) {
      setSelectedCamId((cur) => (cur === requestedCameraId ? cur : requestedCameraId));
      return;
    }
    if (!selectedCamId || !lista.some((i) => i.camera.id === selectedCamId)) {
      setSelectedCamId(lista[0].camera.id);
    }
  }, [lista, requestedCameraId, selectedCamId]);

  const selecionada = lista.find((i) => i.camera.id === selectedCamId) ?? null;
  const totalComPerimetro = lista.filter((i) => temPerimetro(i.resumo)).length;

  const abrirEditor = (cameraId: string) => setLocation(`/cameras/${cameraId}?tab=zones`);

  // ── Sem nenhuma câmera ativa ────────────────────────────────────────────
  if (!lista.length) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="ops-card w-full max-w-lg overflow-hidden">
          <div className="border-b border-border px-8 py-6 text-center">
            <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-[hsl(var(--muted-foreground))]" />
            <h1 className="text-[17px] font-semibold">Nenhuma câmera ativa</h1>
            <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-muted-foreground">
              A segurança de perímetro (linha e zona) é configurada por câmera.
              Cadastre ou ative uma câmera para começar.
            </p>
          </div>
          <div className="flex justify-center gap-2 px-8 py-4">
            <button type="button" onClick={() => setLocation('/live')} className="btn btn-secondary btn-sm">Voltar ao Ao Vivo</button>
            {userRole !== 'viewer' && (
              <button type="button" onClick={() => setLocation('/cameras')} className="btn btn-primary btn-sm">Ver câmeras</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Cabeçalho */}
      <div className="page-hdr">
        <div>
          <h1 className="page-title">Segurança de perímetro</h1>
          <p className="page-sub">
            Linha de travessia e zonas de monitorar/ignorar, por câmera ·{' '}
            {totalComPerimetro} de {lista.length} configurada(s)
          </p>
        </div>
        <div className="w-[min(100%,320px)]">
          <SeletorDeCamera
            cameras={camerasSelecionaveis}
            value={selectedCamId}
            onChange={setSelectedCamId}
            placeholder="Selecione uma câmera"
            className="h-10 w-full"
            vazio="Nenhuma câmera ativa."
          />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[1fr_360px]">
        {/* Câmera selecionada, ao vivo */}
        <div className="flex min-h-0 flex-col gap-3">
          {selecionada && (
            <>
              <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-black">
                {selecionada.camera.isOnline ? (
                  <LiveStreamPlayer
                    cameraId={selecionada.camera.id}
                    cameraName={selecionada.camera.name}
                    aiEnabled={selecionada.camera.aiEnabled}
                    showOverlay
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[12px] text-[hsl(var(--muted-foreground))]">
                    Câmera offline — o perímetro continua salvo e volta a valer quando ela retornar.
                  </div>
                )}
              </div>

              <ResumoSelecionada resumo={selecionada.resumo} aiEnabled={selecionada.camera.aiEnabled} />

              <button
                type="button"
                onClick={() => abrirEditor(selecionada.camera.id)}
                className="btn btn-primary btn-sm self-start"
              >
                {temPerimetro(selecionada.resumo) ? 'Editar perímetro' : 'Desenhar perímetro'}
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>

        {/* Frota: quem já tem, quem não tem */}
        <aside className="min-h-0">
          <div className="mb-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
            Câmeras
          </div>
          <div className="flex flex-col gap-1.5">
            {lista.map(({ camera, resumo }) => {
              const ativa = camera.id === selectedCamId;
              return (
                <button
                  key={camera.id}
                  type="button"
                  onClick={() => setSelectedCamId(camera.id)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                    ativa
                      ? 'border-[hsl(var(--primary)_/_0.5)] bg-[hsl(var(--primary)_/_0.08)]'
                      : 'border-border bg-background/55 hover:bg-background'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${camera.isOnline ? 'status-online' : 'status-offline'}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium">{camera.name}</span>
                    <span className="block text-[10px] text-[hsl(var(--muted-foreground))]">
                      {temPerimetro(resumo) ? (
                        <ResumoInline resumo={resumo} />
                      ) : (
                        'sem perímetro'
                      )}
                    </span>
                  </span>
                  {!camera.aiEnabled && (
                    <span title="IA desligada nesta câmera">
                      <EyeOff className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ResumoInline({ resumo }: { resumo: ResumoPerimetro }) {
  const partes: string[] = [];
  if (resumo.linhas) partes.push(`${resumo.linhas} linha${resumo.linhas > 1 ? 's' : ''}`);
  if (resumo.monitorar) partes.push(`${resumo.monitorar} monitorar`);
  if (resumo.ignorar) partes.push(`${resumo.ignorar} ignorar`);
  return <>{partes.join(' · ')}</>;
}

function ResumoSelecionada({ resumo, aiEnabled }: { resumo: ResumoPerimetro; aiEnabled: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Cartao icon={<Spline className="h-4 w-4" />} valor={resumo.linhas} rotulo="Linhas de travessia" />
      <Cartao icon={<SquareDashed className="h-4 w-4" />} valor={resumo.monitorar} rotulo="Zonas monitorar" />
      <Cartao icon={<EyeOff className="h-4 w-4" />} valor={resumo.ignorar} rotulo="Zonas ignorar" />
      {!aiEnabled && (
        <p className="col-span-3 rounded-lg border border-[hsl(var(--chart-4)_/_0.3)] bg-[hsl(var(--chart-4)_/_0.08)] px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          A IA está desligada nesta câmera. A linha ainda funciona pela via da própria
          câmera (ONVIF), mas a detecção por IA local do DRAC só roda com a IA ligada.
        </p>
      )}
    </div>
  );
}

function Cartao({ icon, valor, rotulo }: { icon: React.ReactNode; valor: number; rotulo: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/55 p-3">
      <div className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
        {icon}
        {valor === 0 && <Plus className="h-3 w-3 opacity-50" />}
      </div>
      <div className="mt-1 text-[18px] font-semibold tabular-nums">{valor}</div>
      <div className="text-[10px] leading-tight text-[hsl(var(--muted-foreground))]">{rotulo}</div>
    </div>
  );
}
