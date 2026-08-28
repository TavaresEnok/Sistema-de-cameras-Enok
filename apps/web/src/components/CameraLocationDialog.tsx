import { useEffect, useState } from 'react';
import axios from 'axios';
import { Crosshair, LoaderCircle, LocateFixed, MapPin, Navigation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { getApiBaseUrl } from '../lib/api-base';
import { useAuthStore } from '../store/authStore';
import { useVmsDataStore, type Camera } from '../store/vmsDataStore';
import { useToast } from '../hooks/use-toast';

export type CameraMapPosition = { latitude: number; longitude: number };

type Props = {
  camera: Camera | null;
  open: boolean;
  pickedPosition?: CameraMapPosition | null;
  onOpenChange: (open: boolean) => void;
  onPickMap: () => void;
  onSaved?: () => void;
};

export function CameraLocationDialog({
  camera,
  open,
  pickedPosition,
  onOpenChange,
  onPickMap,
  onSaved,
}: Props) {
  const accessToken = useAuthStore((state) => state.accessToken);
  const loadData = useVmsDataStore((state) => state.load);
  const { toast } = useToast();
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!camera) return;
    setAddress(camera.locationAddress ?? '');
    setLatitude(camera.latitude == null ? '' : String(camera.latitude));
    setLongitude(camera.longitude == null ? '' : String(camera.longitude));
  }, [camera]);

  useEffect(() => {
    if (!pickedPosition) return;
    setLatitude(pickedPosition.latitude.toFixed(7));
    setLongitude(pickedPosition.longitude.toFixed(7));
  }, [pickedPosition]);

  const geocode = async () => {
    if (!accessToken || address.trim().length < 5) return;
    setGeocoding(true);
    try {
      const { data } = await axios.get(`${getApiBaseUrl()}/cameras/location/geocode`, {
        params: { address: address.trim() },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      setAddress(data.displayName || address.trim());
      setLatitude(String(data.latitude));
      setLongitude(String(data.longitude));
      toast({ title: 'Endereço encontrado', description: 'Confira o ponto e clique em Salvar localização.' });
    } catch (error) {
      const description = axios.isAxiosError(error)
        ? error.response?.data?.message ?? error.message
        : 'Não foi possível localizar este endereço.';
      toast({ title: 'Endereço não encontrado', description, variant: 'destructive' });
    } finally {
      setGeocoding(false);
    }
  };

  const useDeviceLocation = () => {
    if (!navigator.geolocation) {
      toast({ title: 'GPS indisponível', description: 'Este navegador não fornece geolocalização.', variant: 'destructive' });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(7));
        setLongitude(position.coords.longitude.toFixed(7));
        setLocating(false);
        toast({ title: 'Posição capturada', description: 'Use esta opção somente quando o dispositivo estiver junto à câmera.' });
      },
      (error) => {
        setLocating(false);
        toast({
          title: 'Não foi possível obter a posição',
          description: error.message || 'Autorize a localização do navegador e tente novamente.',
          variant: 'destructive',
        });
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  };

  const save = async () => {
    if (!camera || !accessToken) return;
    const lat = Number(latitude.replace(',', '.'));
    const lng = Number(longitude.replace(',', '.'));
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      toast({ title: 'Coordenadas inválidas', description: 'Informe latitude e longitude válidas.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await axios.patch(
        `${getApiBaseUrl()}/cameras/${camera.id}`,
        { locationAddress: address.trim() || null, latitude: lat, longitude: lng },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      await loadData();
      toast({ title: 'Localização salva', description: `${camera.name} foi atualizada no mapa.` });
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      const description = axios.isAxiosError(error)
        ? (Array.isArray(error.response?.data?.message)
            ? error.response?.data?.message.join('\n')
            : error.response?.data?.message) ?? error.message
        : 'Não foi possível salvar a localização.';
      toast({ title: 'Erro ao salvar', description, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> Localização da câmera</DialogTitle>
          <DialogDescription>
            {camera?.name ?? 'Câmera'} · escolha o endereço, o GPS deste dispositivo, um ponto no mapa ou coordenadas manuais.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="camera-map-address" className="text-xs font-medium">Endereço completo</label>
            <div className="flex gap-2">
              <Input
                id="camera-map-address"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void geocode(); }}
                placeholder="Rua, número, bairro, cidade e estado"
              />
              <Button type="button" variant="outline" onClick={() => void geocode()} disabled={geocoding || address.trim().length < 5} className="shrink-0 gap-1.5">
                {geocoding ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />} Localizar
              </Button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="button" variant="outline" onClick={useDeviceLocation} disabled={locating} className="justify-start gap-2">
              {locating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
              GPS deste dispositivo
            </Button>
            <Button type="button" variant="outline" onClick={onPickMap} className="justify-start gap-2">
              <Crosshair className="h-4 w-4" /> Escolher ponto no mapa
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="camera-map-latitude" className="text-xs font-medium">Latitude</label>
              <Input id="camera-map-latitude" value={latitude} onChange={(event) => setLatitude(event.target.value)} inputMode="decimal" className="font-mono text-xs" placeholder="-8.0542800" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="camera-map-longitude" className="text-xs font-medium">Longitude</label>
              <Input id="camera-map-longitude" value={longitude} onChange={(event) => setLongitude(event.target.value)} inputMode="decimal" className="font-mono text-xs" placeholder="-34.8813000" />
            </div>
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            O GPS representa este computador ou celular. Use-o apenas estando no local da câmera; para instalações remotas, pesquise o endereço ou marque o ponto no mapa.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={() => void save()} disabled={saving || !camera}>
            {saving && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />} Salvar localização
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

