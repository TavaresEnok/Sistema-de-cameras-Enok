import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Square, SquareDashed } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PainelDeDeteccoes } from '../components/PainelDeDeteccoes';
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
  aiConfidence: number;
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

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [cfg, esc] = await Promise.all([
        client.get<AiSettings>('/ai/settings'),
        client.get<{ classes: string[]; cameras: EscopoDaCamera[] }>('/ai/escopo-objeto'),
      ]);
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

  const rodando = escopo.filter((c) => c.roda).length;
  const mostrarCaixa = settings?.showObjectBox !== false;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="page-hdr flex items-center gap-3">
        <p className="page-sub min-w-0 flex-1">
          {classes.length
            ? `${rodando} de ${escopo.length} câmera(s) analisando · ${classes.length} tipo(s) disponível(is)`
            : 'Detecção de objetos não liberada para esta instalação.'}
        </p>
        <button
          type="button"
          onClick={() => void alternarCaixa(!mostrarCaixa)}
          disabled={salvando || !settings}
          className="btn btn-secondary btn-sm shrink-0"
          aria-pressed={mostrarCaixa}
          title="Mostra ou esconde o quadrado no vídeo; não altera a detecção"
        >
          {mostrarCaixa ? <Square className="h-3.5 w-3.5" aria-hidden /> : <SquareDashed className="h-3.5 w-3.5" aria-hidden />}
          Marcação {mostrarCaixa ? 'visível' : 'oculta'}
        </button>
      </div>

      {erro && (
        <div className="mx-4 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {erro}
        </div>
      )}

      {/* A ORDEM DAS ABAS É A ORDEM DAS PERGUNTAS, da mais frequente para a mais
          rara. O operador abre a IA para ver O QUE ELA ACHOU — isso é todo dia.
          Configurar é uma vez por câmera, no dia da instalação. Até 13/08/2026
          estava invertido: a página abria num formulário, e a fila de detecções
          (a única tela em que a IA devolve valor visível) estava fora do menu. */}
      <Tabs defaultValue="deteccoes" className="flex min-h-0 flex-1 flex-col" aria-busy={carregando}>
        <TabsList className="mx-4 mt-3 h-8 w-fit shrink-0 border border-border bg-card">
          {[
            ['deteccoes', 'Detecções'],
            ['configurar', 'Configuração'],
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

      </Tabs>
    </div>
  );
}
