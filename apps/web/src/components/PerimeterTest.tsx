import { useEffect, useRef, useState } from 'react';
import { LiveStreamPlayer } from './LiveStreamPlayer';
import { liveDetectionsPoller, type LiveDetection } from '../lib/live-detections-poller';
import { testTrajectory } from '../lib/perimeter-test';
import type { DetectionZone } from './DetectionZonesEditor';

export function PerimeterTest({ cameraId, cameraName, zones }: { cameraId: string; cameraName: string; zones: DetectionZone[] }) {
  const [detections, setDetections] = useState<LiveDetection[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const [simulated, setSimulated] = useState<number[] | null>(null);
  const [ratio, setRatio] = useState('16 / 9');
  const frame = useRef<HTMLDivElement>(null);
  const previousSimulation = useRef<number[] | null>(null);
  const previousTracks = useRef(new Map<number, { point: number[]; at: number }>());
  const announce = (names: string[], label: string) => {
    if (names.length) setMessages((items) => [`${new Date().toLocaleTimeString('pt-BR')} · ${label}: ${names.join(', ')}`, ...items].slice(0, 8));
  };
  useEffect(() => {
    const timer = setInterval(() => {
      const video = frame.current?.querySelector('video');
      if (video?.videoWidth && video.videoHeight) setRatio(`${video.videoWidth} / ${video.videoHeight}`);
    }, 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => liveDetectionsPoller.subscribe(cameraId, (items) => {
    setDetections(items);
    const now = Date.now();
    for (const [id, track] of previousTracks.current) if (now - track.at > 2000) previousTracks.current.delete(id);
    for (const d of items) {
      if (d.trackId == null || !d.frameWidth || !d.frameHeight) continue;
      const point = [(d.bbox[0] + d.bbox[2]) / 2 / d.frameWidth, Math.max(d.bbox[1], d.bbox[3]) / d.frameHeight];
      const previous = previousTracks.current.get(d.trackId);
      announce(testTrajectory(previous?.point ?? null, point, zones), 'Detecção observada');
      previousTracks.current.set(d.trackId, { point, at: now });
    }
  }), [cameraId, zones]);
  return <section className="space-y-3 rounded-xl border border-primary/40 p-4">
    <h2 className="font-semibold">Teste visual do perímetro</h2>
    <p className="text-xs text-muted-foreground">Arraste sobre a imagem para simular uma passagem. O teste também acompanha objetos quando a análise já está ativa. As simulações não geram gravações, sirenes ou notificações. As regras reais continuam funcionando normalmente.</p>
    <div ref={frame} className="relative overflow-hidden rounded-lg bg-black" style={{ aspectRatio: ratio }}>
      <LiveStreamPlayer cameraId={cameraId} cameraName={cameraName} liveViewMode="selected" muted showOverlay={false} aiEnabled={false} />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 z-20 h-full w-full touch-none"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); previousSimulation.current = null; }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const r = e.currentTarget.getBoundingClientRect();
          const p = [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
          announce(testTrajectory(previousSimulation.current, p, zones), 'Simulação');
          previousSimulation.current = p; setSimulated(p);
        }}
        onPointerUp={() => { previousSimulation.current = null; }}>
        {zones.map((z) => z.kind === 'line'
          ? <line key={z.id} x1={z.points[0][0] * 100} y1={z.points[0][1] * 100} x2={z.points[1][0] * 100} y2={z.points[1][1] * 100} stroke="#fbbf24" strokeWidth=".5" />
          : <polygon key={z.id} points={z.points.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')} fill={z.kind === 'exclude' ? '#ef444433' : '#22c55e33'} stroke={z.kind === 'exclude' ? '#ef4444' : '#22c55e'} strokeWidth=".3" />)}
        {detections.filter((d) => d.frameWidth && d.frameHeight).map((d) => <rect key={d.id} x={d.bbox[0] / d.frameWidth! * 100} y={d.bbox[1] / d.frameHeight! * 100} width={(d.bbox[2] - d.bbox[0]) / d.frameWidth! * 100} height={(d.bbox[3] - d.bbox[1]) / d.frameHeight! * 100} fill="none" stroke="#38bdf8" strokeWidth=".4" />)}
        {simulated && <circle cx={simulated[0] * 100} cy={simulated[1] * 100} r="1" fill="white" />}
      </svg>
    </div>
    <div aria-live="polite" className="space-y-1 text-xs">{messages.length ? messages.map((m, i) => <p key={i}>{m}</p>) : <p className="text-muted-foreground">Aguardando uma passagem. O teste geométrico não comprova que o detector esteja ativo.</p>}</div>
  </section>;
}
