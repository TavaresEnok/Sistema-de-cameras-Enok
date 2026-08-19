import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { DEFAULT_API_URL, SESSION_KEY } from '../config';
import type { Session } from '../types';

const BIOMETRIC_LOGIN_KEY = `${SESSION_KEY}.biometric`;
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  // Tokens não devem migrar para outro aparelho via backup/restauração do
  // sistema. Também ficam indisponíveis enquanto o dispositivo está bloqueado.
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export function cleanApiUrl(value: string) {
  const raw = value.trim() || DEFAULT_API_URL;
  if (!raw) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try { parsed = new URL(candidate); }
  catch { throw new Error('Endereço do servidor inválido. Use, por exemplo, https://servidor.com/api.'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('O servidor precisa usar um endereço HTTP ou HTTPS válido.');
  }
  if (parsed.username || parsed.password) throw new Error('Não inclua usuário ou senha no endereço do servidor.');
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/+$/, '');
}

export async function loadStoredSession() {
  const secureRaw = await SecureStore.getItemAsync(SESSION_KEY, SECURE_OPTIONS);
  if (secureRaw) return secureRaw;

  const legacyRaw = await AsyncStorage.getItem(SESSION_KEY);
  if (legacyRaw) {
    await SecureStore.setItemAsync(SESSION_KEY, legacyRaw, SECURE_OPTIONS);
    await AsyncStorage.removeItem(SESSION_KEY);
  }
  return legacyRaw;
}

export async function saveStoredSession(session: Session) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), SECURE_OPTIONS);
  await AsyncStorage.removeItem(SESSION_KEY);
}

export async function clearStoredSession() {
  await SecureStore.deleteItemAsync(SESSION_KEY);
  await AsyncStorage.removeItem(SESSION_KEY);
}

export async function isBiometricLoginEnabled() {
  return (await SecureStore.getItemAsync(BIOMETRIC_LOGIN_KEY, SECURE_OPTIONS)) === 'true';
}

export async function setBiometricLoginEnabled(enabled: boolean) {
  if (enabled) await SecureStore.setItemAsync(BIOMETRIC_LOGIN_KEY, 'true', SECURE_OPTIONS);
  else await SecureStore.deleteItemAsync(BIOMETRIC_LOGIN_KEY);
}
