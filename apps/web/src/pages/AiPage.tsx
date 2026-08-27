import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Brain, Check, Info, Loader2, RefreshCw, Square, SquareDashed } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PainelDeDeteccoes } from '../components/PainelDeDeteccoes';
import { PainelDeCamerasDaIa } from '../components/PainelDeCamerasDaIa';
import { ConfiguracaoFacilDaIa } from '../components/ConfiguracaoFacilDaIa';
import { getApiBaseUrl } from '../lib/api-base';
import { useAuthStore } from '../store/authStore';
import { toast } from '../hooks/use-toast';
import { getRequestErrorMessage } from '../lib/request-error';
import { useAiPreferencesStore } from '../store/aiPreferencesStore';

const API_URL = getApiBaseUrl();

type AiSettings = {
  enabled: boolean;
  mode: string;
  showObjectBox?: boolean;
};

/** O pedaço de /gpu/status que interessa a quem opera a IA, não a quem opera o servidor. */
type EstadoDaGpu = {
  vendor?: string;
  enabled?: boolean;
  ready?: boolean;
  device?: { name?: string | null } | null;
  checks?: { aiAccel?: boolean };
};

type EscopoDaCamera = {
  cameraId: string;
  nome: string;
  roda: boolean;
  explicacao: string;
  objectMode: 'auto' | 'sempre' | 'nunca';
  temLinha: boolean;
  aiEnabled: boolean;
  aiObjectClasses: string[];
  aiSensitivity: 'sensitive' | 'balanced' | 'precise';
  recordingMode: string;
  motionTrigger: string;
};

/**
 * Página de IA da instalação.
 *
 * A divisão que orienta esta tela: a CENTRAL decide O QUE pode ser detectado
 * (quais classes de objeto — é escopo comercial, e cada classe custa CPU no
 * servidor do cliente); a INSTALAÇÃO decide ONDE vale a pena pagar por isso e
 * COMO aparece na tela.
 *
 * A Central define o catálogo contratado; a instalação escolhe, por câmera,
 * o subconjunto que faz sentido naquela cena. Assim a câmera nunca amplia a
 * licença, mas o operador também não precisa detectar carro numa portaria de
 * pedestres só porque as duas classes estão disponíveis no contrato.
 */
export default function AiPage() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const client = useMemo(
    () => axios.create({ baseURL: API_URL, headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined, timeout: 20000 }),
    [accessToken],
  );

  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  const [escopo, setEscopo] = useState<EscopoDaCamera[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [gpu, setGpu] = useState<EstadoDaGpu | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [cfg, esc] = await Promise.all([
        client.get<AiSettings>('/ai/settings'),
        client.get<{ classes: string[]; cameras: EscopoDaCamera[] }>('/ai/escopo-objeto'),
      ]);
      // A GPU é INFORMATIVA aqui e vem separada de propósito: a rota exige
      // ADMIN, e um operador sem esse papel não pode perder o resto da tela por
      // causa de um 403 num cartão secundário.
      void client.get<EstadoDaGpu>('/gpu/status')
        .then((r) => setGpu(r.data))
        .catch(() => setGpu(null));
      setSettings(cfg.data);
      setClasses(Array.isArray(esc.data?.classes) ? esc.data.classes : []);
      setEscopo(Array.isArray(esc.data?.cameras) ? esc.data.cameras : []);
      setErro(null);
    } catch (e) {
      // Não zera o que já está na tela: cair no estado vazio faria o operador
      // achar que a IA foi desconfigurada, quando só a rede falhou.
      setErro(getRequestErrorMessage(e, 'Não foi possível carregar as configurações de IA.'));
    } finally {
      setCarregando(false);
    }
  }, [client]);

  useEffect(() => { void carregar(); }, [carregar]);

  const alternarCaixa = useCallback(async (valor: boolean) => {
    setSalvando(true);
    setSettings((s) => (s ? { ...s, showObjectBox: valor } : s));
    // Reflete no Ao Vivo imediatamente, sem esperar o próximo carregamento.
    useAiPreferencesStore.getState().definirCaixa(valor);
    try {
      await client.patch('/ai/settings', { showObjectBox: valor });
      toast({ title: valor ? 'Marcação ligada' : 'Marcação desligada', description: 'A mudança aparece no Ao Vivo em alguns segundos.' });
    } catch (e) {
      setSettings((s) => (s ? { ...s, showObjectBox: !valor } : s));
      useAiPreferencesStore.getState().definirCaixa(!valor);
      toast({ title: 'Não foi possível salvar', description: getRequestErrorMessage(e, 'Falha ao salvar a preferência.'), variant: 'destructive' });
    } finally {
      setSalvando(false);
    }
  }, [client]);

  const mudarModo = useCallback(async (cameraId: string, objectMode: EscopoDaCamera['objectMode']) => {
    setEscopo((atual) => atual.map((c) => (c.cameraId === cameraId ? { ...c, objectMode } : c)));
    try {
      await client.patch(`/cameras/${cameraId}`, { objectMode });
      await carregar();
    } catch (e) {
      toast({ title: 'Não foi possível salvar', description: getRequestErrorMessage(e, 'Falha ao mudar o modo.'), variant: 'destructive' });
      await carregar();
    }
  }, [client, carregar]);

  const rodando = escopo.filter((c) => c.roda).length;
  const objetoLiberado = classes.length > 0;
  const mostrarCaixa = settings?.showObjectBox !== false;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="page-hdr">
        <div>
          <p className="page-sub">
            {objetoLiberado
              ? `Reconhece ${classes.length} tipo(s) de objeto · ${rodando} de ${escopo.length} câmera(s) usando.`
              : 'Reconhecimento de objeto não liberado para esta instalação.'}
          </p>
        </div>
      </div>

      {/* A ORDEM DAS ABAS É A ORDEM DAS PERGUNTAS, da mais frequente para a mais
          rara. O operador abre a IA para ver O QUE ELA ACHOU — isso é todo dia.
          Configurar é uma vez por câmera, no dia da instalação. Até 13/08/2026
          estava invertido: a página abria num formulário, e a fila de detecções
          (a única tela em que a IA devolve valor visível) estava fora do menu. */}
      <Tabs defaultValue="deteccoes" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-4 mt-3 h-8 w-fit shrink-0 border border-border bg-card">
          {[
            ['deteccoes', 'Detecções'],
            ['configurar', 'Configurar'],
            ['diagnostico', 'Diagnóstico'],
            ['ajustes', 'Ajustes'],
          ].map(([valor, rotulo]) => (
            <TabsTrigger key={valor} value={valor} className="h-6 px-3 text-xs">
              {rotulo}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="deteccoes" className="mt-2 min-h-0 flex-1 focus-visible:outline-none">
          <PainelDeDeteccoes comCabecalho={false} />
        </TabsContent>

        <TabsContent value="configurar" className="mt-2 min-h-0 flex-1 focus-visible:outline-none">
          <ConfiguracaoFacilDaIa
            camerasDaIa={escopo}
            classesPermitidas={classes}
            onRecarregar={carregar}
          />
        </TabsContent>

        <TabsContent value="diagnostico" className="mt-2 min-h-0 flex-1 focus-visible:outline-none">
          <PainelDeCamerasDaIa
            escopo={escopo}
            objetoLiberado={objetoLiberado}
            onMudarModo={mudarModo}
            onRecarregarEscopo={carregar}
          />
        </TabsContent>

        <TabsContent value="ajustes" className="mt-0 min-h-0 flex-1 overflow-y-auto focus-visible:outline-none">
          <div className="grid gap-4 p-4 sm:grid-cols-2 xl:max-w-3xl">
          <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-medium">Exibição no Ao Vivo</h2>
            </div>
            <div className="px-4 py-3">
              <button
                type="button"
                onClick={() => void alternarCaixa(!mostrarCaixa)}
                disabled={salvando || !settings}
                className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2.5 text-left hover:bg-[hsl(var(--accent))] disabled:opacity-45"
                aria-pressed={mostrarCaixa}
              >
                {mostrarCaixa
                  ? <Square className="h-4 w-4 shrink-0 text-[hsl(var(--primary))]" aria-hidden />
                  : <SquareDashed className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">Mostrar quadrado no objeto</span>
                  <span className="block text-[10px] text-[hsl(var(--muted-foreground))]">
                    {mostrarCaixa ? 'A marcação aparece sobre o vídeo.' : 'O vídeo aparece limpo, sem marcação.'}
                  </span>
                </span>
                {mostrarCaixa && <Check className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" aria-hidden />}
              </button>
              <p className="mt-2 text-[10px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                Só muda o que é desenhado na tela — a detecção continua igual, e os eventos seguem sendo registrados.
              </p>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <Brain className="h-3.5 w-3.5" aria-hidden />
                O que procurar
              </h2>
            </div>
            <div className="px-4 py-3">
              {objetoLiberado ? (
                <div className="flex flex-wrap gap-1.5">
                  {classes.map((c) => (
                    <span key={c} className="rounded-full border border-border px-2.5 py-1 text-[11px]">
                      {NOME_DA_CLASSE[c] ?? c}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                  Nenhum tipo de objeto liberado. Só a detecção de movimento está ativa.
                </p>
              )}
              {/* O trabalho invisível: a supressão de luz piscando e de movimento
                  crônico é o que separa este sistema dos concorrentes, e até
                  13/08/2026 nenhuma tela dizia que existia. O cliente não sabia
                  o que tinha comprado. */}
              <div className="mt-3 rounded-md border border-border px-2.5 py-2">
                <p className="text-[10px] font-medium">O que a IA descarta sozinha</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-3.5 text-[10px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                  <li>Luz que pisca com ritmo de máquina — letreiro, LED, sinaleira.</li>
                  <li>Região que se mexe o tempo todo — bandeira, água, folha ao vento.</li>
                  <li>Objeto que apareceu num quadro só, sem se confirmar nos seguintes.</li>
                </ul>
                <p className="mt-1.5 text-[10px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                  É o que evita gravar a noite inteira por causa de uma lâmpada. Não precisa
                  configurar nada — já está ativo em todas as câmeras.
                </p>
              </div>

              {/* PLACA DE VÍDEO. Estava só na tela de servidor, escrita para quem
                  opera infraestrutura. Quem cuida da IA precisa saber se a
                  aceleração está valendo — em CPU o mesmo servidor atende menos
                  câmeras, e essa é uma informação de IA, não de máquina. */}
              {gpu && (
                <div className="mt-3 rounded-md border border-border px-2.5 py-2">
                  <p className="text-[10px] font-medium">Placa de vídeo</p>
                  {gpu.checks?.aiAccel && gpu.enabled ? (
                    <p className="mt-1 text-[10px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                      A IA usa a placa <strong className="font-medium text-foreground">{gpu.device?.name ?? 'instalada'}</strong>.
                      O mesmo servidor atende mais câmeras assim.
                    </p>
                  ) : gpu.ready ? (
                    <p className="mt-1 text-[10px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                      Há uma placa disponível ({gpu.device?.name ?? 'detectada'}) e a IA ainda está
                      rodando no processador. Ligar a aceleração em Ajustes do servidor aumenta
                      quantas câmeras cabem.
                    </p>
                  ) : (
                    <p className="mt-1 text-[10px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                      A IA está rodando no processador. É o modo normal — placa de vídeo é
                      opcional e serve para caber mais câmeras no mesmo servidor.
                    </p>
                  )}
                </div>
              )}
              {/* A Central amplia/reduz o catálogo contratado; a seleção por
                  câmera fica na aba Configurar. */}
              <div className="mt-3 flex gap-2 rounded-md bg-[hsl(var(--muted)_/_0.4)] px-2.5 py-2">
                <Info className="mt-0.5 h-3 w-3 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden />
                <p className="text-[10px] leading-relaxed text-[hsl(var(--muted-foreground))]">
                  O painel central define os tipos disponíveis no contrato. Na aba Configurar você
                  escolhe quais deles cada câmera deve procurar; para liberar um tipo novo, fale com
                  o suporte.
                </p>
              </div>
            </div>
          </section>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

const NOME_DA_CLASSE: Record<string, string> = {
  person: 'Pessoa',
  car: 'Carro',
  motorcycle: 'Moto',
  bus: 'Ônibus',
  truck: 'Caminhão',
  bicycle: 'Bicicleta',
  dog: 'Cachorro',
  cat: 'Gato',
};
