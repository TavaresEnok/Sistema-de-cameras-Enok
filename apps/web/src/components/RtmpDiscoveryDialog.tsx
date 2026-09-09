import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Camera, Eye, LoaderCircle, Plus, RotateCcw, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useAuthStore } from '../store/authStore';
import { getApiBaseUrl } from '../lib/api-base';
import { toast } from '../hooks/use-toast';

type Equipment = { path: string; remoteAddr?: string | null; lastSeenAt?: number; ignoredAt?: number };
type Preview = { id: string; path: string; expiresAt: number };
const base = () => `${getApiBaseUrl()}/cameras/rtmp-discovery`;

export function RtmpDiscoveryDialog({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void | Promise<void>;
}) {
  const token = useAuthStore(s => s.accessToken);
  const [items, setItems] = useState<Equipment[]>([]);
  const [ignored, setIgnored] = useState<Equipment[]>([]);
  const [showIgnored, setShowIgnored] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [imageAt, setImageAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<Equipment | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // If binding fails, retry that same camera instead of creating duplicates.
  const created = useRef<{ path: string; id: string } | null>(null);
  const objectUrl = useRef<string | null>(null);
  const activePreview = useRef<Preview | null>(null);
  const headers = useCallback(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const report = (e: unknown) => toast({ title: 'Não foi possível concluir', variant: 'destructive',
    description: axios.isAxiosError(e) ? String(e.response?.data?.message || e.message) : String(e) });
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const { data } = await axios.get(base() + '/list', { headers: headers(), signal });
    setItems(data.items); setIgnored(data.ignored); setError(''); setLoading(false);
  }, [headers]);
  const stop = useCallback(async () => {
    const active = activePreview.current;
    activePreview.current = null;
    setPreview(null);
    if (active) await axios.post(base() + '/stop', { id: active.id }, { headers: headers(), timeout: 10000 });
  }, [headers]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refresh(controller.signal); }
      catch (e) { if (!controller.signal.aborted) { setError('Não foi possível consultar os equipamentos. Tentando novamente…'); setLoading(false); } }
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, refresh]);
  useEffect(() => {
    if (!open || !preview) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    setImage(null); setImageAt(0);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const frame = async () => {
      if (Date.now() >= preview.expiresAt) { void stop().catch(report); return; }
      try {
        const response = await axios.get(base() + '/frame', { params: { id: preview.id }, headers: headers(), signal: controller.signal, responseType: 'blob', timeout: 9000 });
        if (!controller.signal.aborted && response.status === 200 && response.data.type.startsWith('image/')) {
          const next = URL.createObjectURL(response.data);
          if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
          objectUrl.current = next; setImage(next); setImageAt(Date.now());
        }
      } catch { /* Camera may not have retried publishing yet; next poll recovers. */ }
      if (!controller.signal.aborted) timer = setTimeout(frame, 2500);
    };
    void frame();
    return () => { controller.abort(); clearInterval(tick); clearTimeout(timer);
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; setImage(null); };
  }, [open, preview, headers, stop]);
  useEffect(() => () => {
    const active = activePreview.current;
    if (active) void axios.post(base() + '/stop', { id: active.id }, { headers: headers(), timeout: 10000 }).catch(() => undefined);
  }, [headers]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); try { await action(); } catch (e) { report(e); } finally { setBusy(false); }
  };
  const inspect = (item: Equipment) => run(async () => {
    await stop();
    const { data } = await axios.post(base() + '/preview', { path: item.path }, { headers: headers() });
    activePreview.current = { id: data.id, path: item.path, expiresAt: data.expiresAt };
    setPreview(activePreview.current); setNow(Date.now());
    setSelected(item); setName('');
  });
  const ignore = (item: Equipment, undo = false) => run(async () => {
    if (preview?.path === item.path) await stop();
    await axios.post(base() + '/ignore', { path: item.path, undo }, { headers: headers() });
    if (selected?.path === item.path) setSelected(null);
    await refresh();
  });
  const add = () => run(async () => {
    if (!selected || !name.trim()) return;
    if (created.current && created.current.path !== selected.path) throw new Error('Conclua o vínculo da câmera anterior antes de adicionar outra.');
    if (!created.current) {
      const { data } = await axios.post(`${getApiBaseUrl()}/cameras`, {
        name: name.trim(), sourceMode: 'rtmp_push', recordingEnabled: false, recordingMode: 'manual', aiEnabled: false,
      }, { headers: headers() });
      created.current = { id: data.id, path: selected.path };
    }
    await axios.post(`${getApiBaseUrl()}/cameras/${created.current.id}/rtmp-ingest/bind`, { path: selected.path }, { headers: headers() });
    created.current = null; await stop(); setSelected(null); setName('');
    toast({ title: 'Câmera adicionada', description: 'Gravação manual, desligada. Você pode ativá-la em Gravações.' });
    await refresh(); await onCreated();
  });
  const close = () => { if (busy) return; void stop().catch(report); onClose(); };
  const visible = showIgnored ? ignored : items;
  return <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
    <DialogContent className="max-w-4xl max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>Equipamentos RTMP</DialogTitle>
        <DialogDescription>Identifique as transmissões recebidas antes de adicioná-las. A prévia não grava vídeo.</DialogDescription>
      </DialogHeader>
      <div className="flex gap-2">
        <Button variant={!showIgnored ? 'default' : 'outline'} onClick={() => setShowIgnored(false)}>Pendentes ({items.length})</Button>
        <Button variant={showIgnored ? 'default' : 'outline'} onClick={() => setShowIgnored(true)}>Ignoradas ({ignored.length})</Button>
      </div>
      {error && <p role="status" className="text-sm text-amber-500">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 max-h-[55dvh] overflow-y-auto">
          {loading ? <p className="text-sm text-muted-foreground p-4">Buscando equipamentos…</p> : visible.length === 0 && <p className="text-sm text-muted-foreground p-4">{showIgnored ? 'Nenhum equipamento ignorado.' : 'Nenhuma transmissão pendente no momento.'}</p>}
          {visible.map((item, i) => <div key={item.path} className={`rounded-lg border p-3 space-y-2 ${selected?.path === item.path ? 'border-primary bg-primary/5' : 'border-border'}`}>
            <p className="text-sm font-medium">Equipamento {i + 1}</p>
            {item.lastSeenAt && <p className="text-xs text-muted-foreground">Última tentativa: {new Date(item.lastSeenAt).toLocaleTimeString()}</p>}
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Identificação técnica</summary><p className="break-all py-2">{item.path}</p>{item.remoteAddr && <p>Origem: {item.remoteAddr}</p>}</details>
            <div className="flex flex-wrap gap-2">
              {showIgnored ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void ignore(item, true)}><RotateCcw className="w-4 h-4 mr-1" />Restaurar</Button> : <>
                <Button size="sm" variant="outline" disabled={busy || !!created.current} onClick={() => void inspect(item)}><Eye className="w-4 h-4 mr-1" />Espiar</Button>
                <Button size="sm" disabled={busy || !!created.current} onClick={() => void run(async () => { if (preview?.path !== item.path) await stop(); setSelected(item); setName(''); })}><Plus className="w-4 h-4 mr-1" />Adicionar</Button>
                <Button size="sm" variant="ghost" disabled={busy || !!created.current} onClick={() => void ignore(item)}>Ignorar</Button>
              </>}
            </div>
          </div>)}
        </div>
        <div className="space-y-3">
          <div className="relative aspect-video rounded-lg border bg-muted/30 flex items-center justify-center overflow-hidden">
            {preview && image ? <img src={image} alt="Prévia da câmera RTMP selecionada" className="h-full w-full object-contain" /> : <div className="p-5 text-center text-sm text-muted-foreground">
              {preview ? <><LoaderCircle className="w-8 h-8 mx-auto mb-3 animate-spin" /><p>Aguardando imagem da câmera…</p><p className="text-xs mt-2">O equipamento precisa tentar transmitir novamente.</p></> : <><Camera className="w-9 h-9 mx-auto mb-3" />Selecione Espiar para identificar a câmera.</>}
            </div>}
            {preview && <div className="absolute bottom-0 inset-x-0 bg-black/75 p-2 text-xs text-white flex justify-between items-center">
              <span>{imageAt && now - imageAt > 10000 ? 'Última imagem recebida · ' : 'Prévia · '}{Math.max(0, Math.ceil((preview.expiresAt - now) / 1000))} s</span>
              <button aria-label="Encerrar prévia" onClick={() => void stop().catch(report)}><X className="w-4 h-4" /></button>
            </div>}
          </div>
          {selected && <div className="rounded-lg border p-3 space-y-3">
            <label htmlFor="discovery-camera-name" className="text-sm font-medium">Nome da câmera</label>
            <Input id="discovery-camera-name" maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Entrada principal" disabled={busy || !!created.current} />
            <p className="text-xs text-muted-foreground">A câmera será adicionada com a gravação desligada.</p>
            {created.current && <p role="status" className="text-xs text-amber-500">Cadastro criado. Conclua o vínculo abaixo; não é necessário criar outra câmera.</p>}
            <Button disabled={busy || !name.trim()} onClick={() => void add()} className="w-full">{busy && <LoaderCircle className="w-4 h-4 mr-2 animate-spin" />}{created.current ? 'Concluir vínculo' : 'Confirmar cadastro'}</Button>
          </div>}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
