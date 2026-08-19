import { Platform, StatusBar as NativeStatusBar } from 'react-native';
import { BRANDING } from './branding';
import Constants from 'expo-constants';

// Servidor embutido por cliente (white-label) tem prioridade; cai para a env
// pública e, por fim, vazio (usuário digita em "Servidor" no login).
export const DEFAULT_API_URL = BRANDING.apiUrl || (process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '') ?? '');
export const SESSION_KEY = 'drac.mobile.session.v1';
export const TOP_SAFE = Platform.OS === 'android' ? Math.max(NativeStatusBar.currentHeight ?? 24, 28) : 0;
export const BOTTOM_SAFE = Platform.OS === 'android' ? 48 : 0;
export const ALLOW_CLEARTEXT_TRAFFIC = Constants.expoConfig?.extra?.allowCleartextTraffic === true;
