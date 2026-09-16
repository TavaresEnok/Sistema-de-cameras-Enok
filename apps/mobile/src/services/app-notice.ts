export type AppNoticeTone = 'info' | 'success' | 'warning' | 'error';

export type AppNotice = {
  id: number;
  title: string;
  message?: string;
  tone: AppNoticeTone;
  durationMs: number;
};

type Listener = (notice: AppNotice | null) => void;

let current: AppNotice | null = null;
let nextId = 1;
const listeners = new Set<Listener>();

function publish() {
  listeners.forEach((listener) => listener(current));
}

/** Aviso visual do próprio S2Cam. Substitui os pop-ups cinza do Android. */
export function showAppNotice(
  title: string,
  message = '',
  tone: AppNoticeTone = 'info',
  durationMs = 4200,
) {
  current = { id: nextId++, title, message, tone, durationMs };
  publish();
}

export function dismissAppNotice(id?: number) {
  if (id != null && current?.id !== id) return;
  current = null;
  publish();
}

export function subscribeAppNotice(listener: Listener) {
  listeners.add(listener);
  listener(current);
  return () => { listeners.delete(listener); };
}
