/**
 * Branding white-label — valores injetados em build time por app.config.js
 * (a partir de clients/<CLIENT>/config.json) e lidos em runtime via expo-constants.
 *
 * A logo da tela de login é sempre `assets/branding/logo.png` (o script de build
 * troca esse arquivo pelo da pasta do cliente; o default é o ícone do S2Cam).
 */
import Constants from 'expo-constants';

type BrandingExtra = {
  client?: string;
  appName?: string;
  apiUrl?: string;
  primaryColor?: string | null;
  apkBaseUrl?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as BrandingExtra;

export const BRANDING = {
  client: extra.client ?? 'default',
  appName: extra.appName ?? 'S2Cam',
  apiUrl: (extra.apiUrl ?? '').trim().replace(/\/+$/, ''),
  apkBaseUrl: (extra.apkBaseUrl ?? 'https://s2cam.com.br/apk').trim().replace(/\/+$/, ''),
  primaryColor: extra.primaryColor ?? null,
};

// require estático: o bundler resolve em build time; o script troca o arquivo.
export const BRAND_LOGO = require('../assets/branding/logo.png');
