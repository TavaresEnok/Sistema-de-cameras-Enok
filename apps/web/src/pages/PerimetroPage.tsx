import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { ShieldAlert, Spline, SquareDashed, EyeOff } from 'lucide-react';
import { SeletorDeCamera } from '../components/SeletorDeCamera';
import { IlustracaoPerimetro } from '../components/IlustracaoPerimetro';
import { DetectionZonesEditor, type DetectionZone } from '../components/DetectionZonesEditor';
import { useAuthStore } from '../store/authStore';
import { useVmsDataStore } from '../store/vmsDataStore';

// ── PÁGINA DE PERÍMETRO — linha e zona de detecção, por câmera ──────────────
//
// Você DESENHA aqui mesmo, sobre o SNAPSHOT da câmera (não o vídeo ao vivo): o
// snapshot é confiável (aparece mesmo com o streaming instável) e é a MESMA
// imagem que a detecção vê. Antes esta tela mostrava o player ao vivo, que
// ficava preto quando o stream falhava — e sem imagem não dá para desenhar.
//
// O que é cada coisa:
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

export default function PerimetroPage() {
  const [location, setLocation] = useLocation();
  const userRole = useAuthStore((state) => state.user?.role ?? 'viewer');
  const cameras = useVmsDataStore((state) => state.cameras);

  // Estado local do resumo por câmera: começa do store e é atualizado quando o
  // editor salva, para a lista lateral refletir na hora sem recarregar tudo.
  const [zonasPorCamera, setZonasPorCamera] = useState<Record<string, DetectionZone[]>>({});

  const lista = useMemo(
    () => cameras
      .filter((camera) => camera.enabled)
      .map((camera) => {
        const zonas = zonasPorCamera[camera.id]
          ?? (camera.detectionZones as DetectionZone[] | undefined)
          ?? [];
        return { camera, zonas, resumo: resumir(zonas) };
      })
      .sort((a, b) =>
        Number(temPerimetro(b.resumo)) - Number(temPerimetro(a.resumo))
        || Number(b.camera.isOnline) - Number(a.camera.isOnline)
        || a.camera.name.localeCompare(b.camera.name, 'pt-BR')),
    [cameras, zonasPorCamera],
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

  // ── Sem nenhuma câmera ativa ────────────────────────────────────────────
  if (!lista.length) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="ops-card w-full max-w-lg overflow-hidden">
          <div className="border-b border-border px-8 py-6 text-center">
            <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-[hsl(var(--muted-foreground))]" />
            <h1 className="text-[17px] font-semibold">Nenhuma câmera ativa</h1>
            <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-muted-foreground">
              O perímetro (linha e zona) é configurado por câmera, desenhado sobre
              a imagem dela. Cadastre ou ative uma câmera para começar.
            </p>
            {/* Sem câmera, o lugar da imagem ficava vazio e ninguém entendia o
                que iria desenhar ali. O exemplo mostra o resultado antes de
                existir a primeira câmera. */}
            <div className="mx-auto mt-5 w-full max-w-sm overflow-hidden rounded-lg border border-border">
              <IlustracaoPerimetro className="block h-auto w-full" />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Assim ficará sobre a imagem da sua câmera.
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
          <p className="page-sub">
            Desenhe a linha de travessia e as zonas sobre a imagem da câmera ·{' '}
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

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[1fr_300px]">
        {/* Editor: DESENHA aqui, sobre o snapshot da câmera */}
        <div className="min-h-0">
          {selecionada && (
            <DetectionZonesEditor
              key={selecionada.camera.id}
              cameraId={selecionada.camera.id}
              cameraName={selecionada.camera.name}
              initialZones={selecionada.zonas}
              onSaved={(zones) =>
                setZonasPorCamera((prev) => ({ ...prev, [selecionada.camera.id]: zones }))
              }
            />
          )}
          {selecionada && !selecionada.camera.aiEnabled && (
            <p className="mt-3 rounded-lg border border-[hsl(var(--chart-4)_/_0.3)] bg-[hsl(var(--chart-4)_/_0.08)] px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              A IA está desligada nesta câmera. A linha ainda funciona pela via da própria
              câmera (ONVIF), mas a detecção por IA local do DRAC só roda com a IA ligada.
            </p>
          )}
        </div>

        {/* Frota: quem já tem perímetro, quem não tem */}
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
                      {temPerimetro(resumo) ? <ResumoInline resumo={resumo} /> : 'sem perímetro'}
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

          {/* Legenda do que cada desenho significa */}
          <div className="mt-4 space-y-1.5 rounded-lg border border-border bg-background/40 p-3 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2"><Spline className="h-3.5 w-3.5" /> Linha — limite que não se atravessa</div>
            <div className="flex items-center gap-2"><SquareDashed className="h-3.5 w-3.5" /> Monitorar — onde a detecção vale</div>
            <div className="flex items-center gap-2"><EyeOff className="h-3.5 w-3.5" /> Ignorar — o que a detecção descarta</div>
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
