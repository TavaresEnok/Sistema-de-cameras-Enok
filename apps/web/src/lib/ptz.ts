import axios from 'axios';
import { getApiBaseUrl } from './api-base';
import { useAuthStore } from '../store/authStore';

export const PTZ_DIRECTIONS = ['Up', 'Down', 'Left', 'Right', 'ZoomIn', 'ZoomOut'] as const;
export type PTZDirection = (typeof PTZ_DIRECTIONS)[number];

type PtzAction =
  | { action: 'start'; direction: PTZDirection; speed?: number }
  | { action: 'step'; direction: PTZDirection; angleDegrees?: number }
  | { action: 'home' }
  | { action: 'stop'; direction?: PTZDirection };

type PtzResponse = {
  status: 'ok' | 'error';
  message?: string;
  cameraId?: string;
  action?: 'start' | 'stop' | 'step' | 'home';
  direction?: PTZDirection;
};

function client() {
  const accessToken = useAuthStore.getState().accessToken;
  return axios.create({
    baseURL: getApiBaseUrl(),
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });
}

export async function sendPtzCommand(cameraId: string, payload: PtzAction) {
  try {
    const { data } = await client().post<PtzResponse>(`/ptz/${cameraId}/move`, payload);
    if (data.status !== 'ok') {
      throw new Error(friendlyPtzError(data.message));
    }
    return data;
  } catch (error) {
    const responseMessage = axios.isAxiosError(error)
      ? (error.response?.data as { message?: string } | undefined)?.message
      : error instanceof Error ? error.message : undefined;
    throw new Error(friendlyPtzError(responseMessage));
  }
}

/** Nunca mostra protocolo, código HTTP ou nome interno para o operador. */
export function friendlyPtzError(message?: string) {
  const raw = String(message ?? '').trim();
  if (/usu[aá]rio|senha|credencial|unauthorized|\b401\b/i.test(raw)) {
    return 'A câmera recusou o usuário ou a senha. Confira as credenciais no cadastro.';
  }
  if (/timeout|unreachable|network|porta|conex[aã]o|\bECONN/i.test(raw)) {
    return 'A câmera não respondeu ao controle. Confira se ela está online e se a porta ONVIF ou HTTP está correta.';
  }
  if (/sem PTZ|fixa|recusou|n[aã]o aceitou|not support|SOAP|endpoint|profile/i.test(raw)) {
    return 'A câmera não aceitou o movimento. Ela pode não ter PTZ ou pode estar com a porta ONVIF/HTTP incorreta.';
  }
  return 'Não foi possível mover a câmera agora. Aguarde alguns segundos e tente novamente.';
}
