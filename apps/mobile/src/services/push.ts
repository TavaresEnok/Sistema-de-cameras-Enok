import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { request } from './api';

// Como o app se comporta ao receber um push com o app EM PRIMEIRO PLANO.
// (SDK 54: banner + som + badge; a lista mantém no centro de notificações.)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

let cachedExpoToken: string | null = null;

/** projectId (EAS) — necessário para o Expo emitir o ExponentPushToken. */
function resolveProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? (Constants as any)?.easConfig?.projectId ?? null;
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('alarms', {
    name: 'Alarmes',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#EF4444',
    sound: 'default',
    bypassDnd: false,
    // Em tela bloqueada, o sistema anuncia que há um alarme sem expor câmera,
    // local ou conteúdo do evento para quem estiver com o aparelho na mão.
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

/**
 * Registra o aparelho para push de alarmes:
 *  1) cria o canal Android 'alarms';
 *  2) pede permissão (Android 13+/iOS);
 *  3) obtém o ExponentPushToken;
 *  4) envia ao backend (POST /notifications/devices).
 * Retorna o token Expo (para desregistrar no logout) ou null se indisponível.
 * NUNCA lança — falha de push jamais deve quebrar o login.
 */
export async function registerForPush(apiUrl: string, authToken: string, signal?: AbortSignal): Promise<string | null> {
  try {
    if (signal?.aborted) return null;
    await ensureAndroidChannel();

    // Push real só funciona em aparelho físico (emulador não recebe).
    if (!Device.isDevice) return null;

    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    if (!granted && current.canAskAgain !== false) {
      const asked = await Notifications.requestPermissionsAsync();
      granted = asked.granted || asked.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    }
    if (!granted) return null;

    const projectId = resolveProjectId();
    if (!projectId) {
      // Sem projectId (EAS) o Expo não emite token. App segue normal, sem push.
      console.warn('[push] projectId (EAS) ausente — push desativado. Rode `eas init` e preencha extra.eas.projectId.');
      return null;
    }

    const { data: expoToken } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (signal?.aborted) return null;
    cachedExpoToken = expoToken;

    await request(apiUrl, '/notifications/devices', authToken, {
      method: 'POST',
      body: JSON.stringify({ token: expoToken, platform: Platform.OS }),
      signal,
    });
    return expoToken;
  } catch (error) {
    console.warn('[push] registro falhou:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** Remove o token do backend (logout). Best-effort, nunca lança. */
export async function unregisterFromPush(apiUrl: string, authToken: string, expoToken?: string | null) {
  const token = expoToken ?? cachedExpoToken;
  if (!token) return;
  try {
    await request(apiUrl, '/notifications/devices', authToken, {
      method: 'DELETE',
      body: JSON.stringify({ token }),
    });
  } catch {
    /* ignore */
  } finally {
    cachedExpoToken = null;
  }
}

/**
 * Assina o toque na notificação. `onOpenAlarm` recebe os dados do push
 * (alarmId/cameraId) para o app navegar até os alarmes. Retorna um unsubscribe.
 */
export function subscribeToNotificationTaps(
  onOpenAlarm: (data: { alarmId?: string; cameraId?: string }) => void,
) {
  let active = true;
  const handled = new Set<string>();
  const handle = (response: Notifications.NotificationResponse | null) => {
    if (!active || !response) return;
    const notificationId = response.notification.request.identifier;
    if (handled.has(notificationId)) return;
    handled.add(notificationId);
    const data = (response.notification.request.content.data ?? {}) as {
      alarmId?: string;
      cameraId?: string;
    };
    onOpenAlarm(data);
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  };

  // O listener cobre app aberto/background. A última resposta cobre o cold start
  // (usuário tocou no push quando o processo ainda não existia).
  void Notifications.getLastNotificationResponseAsync().then(handle).catch(() => undefined);
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => {
    active = false;
    sub.remove();
  };
}
