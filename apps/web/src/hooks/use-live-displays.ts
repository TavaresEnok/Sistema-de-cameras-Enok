import { useCallback, useEffect, useRef, useState } from 'react';
import { type LiveDisplayId, liveDisplayLabel } from '../store/gridStore';
import { findCameraDisplay, type LiveDisplayPresence } from '../lib/live-display-coordination';

const CHANNEL = 'drac.live.displays.v1';
const PRESENCE_PREFIX = 'drac.live.display.presence.';
const COMMAND_KEY = 'drac.live.display.command';
type DisplayMessage =
  | { type: 'presence'; payload: LiveDisplayPresence }
  | { type: 'remove-camera'; target: LiveDisplayId; cameraId: string; nonce: string };

function validPresence(value: unknown): value is LiveDisplayPresence {
  const item = value as LiveDisplayPresence;
  return !!item && ['main', 'aux-1', 'aux-2', 'aux-3'].includes(item.displayId)
    && typeof item.instanceId === 'string' && Number.isFinite(item.openedAt)
    && Array.isArray(item.cameraIds) && item.cameraIds.every(id => typeof id === 'string')
    && Number.isFinite(item.updatedAt);
}

export function useLiveDisplays(displayId: LiveDisplayId, cameraIds: string[], removeCamera: (cameraId: string) => void) {
  const [displays, setDisplays] = useState<Record<string, LiveDisplayPresence>>({});
  const [isSuperseded, setIsSuperseded] = useState(false);
  const identityRef = useRef({ instanceId: crypto.randomUUID(), openedAt: Date.now() });
  const supersededRef = useRef(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const removeRef = useRef(removeCamera);
  removeRef.current = removeCamera;

  const receive = useCallback((message: DisplayMessage) => {
    if (message.type === 'presence' && validPresence(message.payload)) {
      if (message.payload.displayId === displayId && message.payload.instanceId !== identityRef.current.instanceId) {
        const ours = identityRef.current;
        const theirsWins = message.payload.openedAt > ours.openedAt
          || (message.payload.openedAt === ours.openedAt && message.payload.instanceId > ours.instanceId);
        if (theirsWins) { supersededRef.current = true; setIsSuperseded(true); }
        return;
      }
      setDisplays(current => {
        const existing = current[message.payload.displayId];
        if (existing && existing.openedAt > message.payload.openedAt) return current;
        return { ...current, [message.payload.displayId]: message.payload };
      });
    }
    if (message.type === 'remove-camera' && message.target === displayId) removeRef.current(message.cameraId);
  }, [displayId]);

  useEffect(() => {
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
    channelRef.current = channel;
    if (channel) channel.onmessage = event => receive(event.data as DisplayMessage);
    const onStorage = (event: StorageEvent) => {
      if (!event.newValue) return;
      try {
        if (event.key?.startsWith(PRESENCE_PREFIX)) receive({ type: 'presence', payload: JSON.parse(event.newValue) });
        if (event.key === COMMAND_KEY) receive(JSON.parse(event.newValue));
      } catch { /* mensagem de outra versão é ignorada */ }
    };
    window.addEventListener('storage', onStorage);
    for (const id of ['main', 'aux-1', 'aux-2', 'aux-3'] as LiveDisplayId[]) {
      try {
        const raw = window.localStorage.getItem(PRESENCE_PREFIX + id);
        if (raw) receive({ type: 'presence', payload: JSON.parse(raw) });
      } catch { /* cache corrompido não impede o ao vivo */ }
    }
    return () => { channel?.close(); channelRef.current = null; window.removeEventListener('storage', onStorage); };
  }, [receive]);

  useEffect(() => {
    const publish = () => {
      if (supersededRef.current) return;
      const payload: LiveDisplayPresence = { displayId, ...identityRef.current, cameraIds: cameraIds.filter(Boolean), updatedAt: Date.now() };
      window.localStorage.setItem(PRESENCE_PREFIX + displayId, JSON.stringify(payload));
      channelRef.current?.postMessage({ type: 'presence', payload } satisfies DisplayMessage);
      setDisplays(current => ({ ...current, [displayId]: payload }));
    };
    publish();
    const timer = window.setInterval(publish, 2_500);
    return () => {
      window.clearInterval(timer);
      const raw = window.localStorage.getItem(PRESENCE_PREFIX + displayId);
      try {
        const current = raw ? JSON.parse(raw) as LiveDisplayPresence : null;
        if (current?.displayId === displayId && current.instanceId === identityRef.current.instanceId) window.localStorage.removeItem(PRESENCE_PREFIX + displayId);
      } catch { window.localStorage.removeItem(PRESENCE_PREFIX + displayId); }
    };
  }, [displayId, cameraIds]);

  const moveFromOtherDisplay = useCallback((target: LiveDisplayId, cameraId: string) => {
    const message: DisplayMessage = { type: 'remove-camera', target, cameraId, nonce: crypto.randomUUID() };
    channelRef.current?.postMessage(message);
    window.localStorage.setItem(COMMAND_KEY, JSON.stringify(message));
  }, []);

  return {
    displays,
    isSuperseded,
    findCameraDisplay: (cameraId: string) => findCameraDisplay(displays, cameraId, displayId),
    moveFromOtherDisplay,
    label: liveDisplayLabel(displayId),
  };
}
