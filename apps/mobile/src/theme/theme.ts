/**
 * S2Cam — temas base claro e escuro.
 * O branding do servidor sobrepõe cada paleta separadamente.
 * Os screens consomem o tema via useTheme() (ver ThemeProvider.tsx).
 */

import { isRedesign } from './redesign';

export interface Theme {
  mode: 'dark' | 'light';

  // Backgrounds
  bg: string;          // fundo da tela
  bg2: string;         // 2ª cor do fundo — se != bg, o fundo vira gradiente
  bgText: string;      // texto sobre o fundo da tela (cabeçalhos fora de cards)
  surface: string;     // cards / painéis / inputs
  surfaceAlt: string;  // superfície alternativa (trilhos, segmentos)

  // Menu inferior (barra de abas) — separável do card
  menu: string;        // fundo da barra de menu
  menuText: string;    // ícone/rótulo de item inativo

  // Borders
  border: string;

  // Accent
  accent: string;
  accentDark: string;
  accentBg: string;    // fundo suave do accent (chips/ícones)

  // Semânticas
  success: string;
  danger: string;
  dangerBg: string;
  warning: string;

  // Texto
  text: string;
  textSub: string;
  textMuted: string;
  textOnAccent: string;

  // Vídeo (sempre escuro, independe do tema)
  videoBg: string;

  // Timeline de gravações
  tlBlue: string;
  tlOrange: string;
  tlHead: string;
}

export const darkTheme: Theme = {
  mode: 'dark',
  bg: '#0b0d12',
  bg2: '#0b0d12',
  bgText: '#f4f6fa',
  surface: '#15181f',
  surfaceAlt: '#1b1f28',
  menu: '#15181f',
  menuText: '#6b7484',
  border: 'rgba(255,255,255,0.08)',
  accent: '#3b82f6',
  accentDark: '#2563eb',
  accentBg: 'rgba(59,130,246,0.16)',
  success: '#22c55e',
  danger: '#ef4444',
  dangerBg: 'rgba(239,68,68,0.12)',
  warning: '#f59e0b',
  text: '#f4f6fa',
  textSub: '#9aa3af',
  textMuted: '#6b7484',
  textOnAccent: '#ffffff',
  videoBg: '#070809',
  tlBlue: '#60a5fa',
  tlOrange: '#fb923c',
  tlHead: '#ef4444',
};

export const lightTheme: Theme = {
  mode: 'light',
  bg: '#f5f7fb',
  bg2: '#ffffff',
  bgText: '#111827',
  surface: '#ffffff',
  surfaceAlt: '#f1f5f9',
  menu: '#ffffff',
  menuText: '#64748b',
  border: '#94a3b8',
  accent: '#2563eb',
  accentDark: '#1d4ed8',
  accentBg: 'rgba(37,99,235,0.10)',
  success: '#15803d',
  danger: '#dc2626',
  dangerBg: 'rgba(220,38,38,0.08)',
  warning: '#b45309',
  text: '#111827',
  textSub: '#4b5563',
  textMuted: '#64748b',
  textOnAccent: '#ffffff',
  videoBg: '#070809',
  tlBlue: '#2563eb',
  tlOrange: '#ea580c',
  tlHead: '#dc2626',
};

/** Compatibilidade para consumidores antigos que esperam um tema base. */
export const baseTheme: Theme = darkTheme;

/**
 * Paletas do REDESIGN (handoff do mockup). Ficam separadas das de cima de propósito:
 * com a flag desligada o app atual não muda em nada. Os valores vêm do tokens.css do
 * designer — fundo um pouco mais fundo, acento mais brilhante, cinzas com viés de azul.
 */
const redesignDark: Theme = {
  ...darkTheme,
  bg: '#0A0D13',
  bg2: '#0A0D13',
  bgText: '#F1F4F9',
  surface: '#12161F',
  surfaceAlt: '#1A2029',
  menu: '#12161F',
  menuText: '#5C6779',
  border: 'rgba(255,255,255,0.07)',
  accent: '#3E8BFF',
  accentDark: '#2E5EEF',
  accentBg: 'rgba(62,139,255,0.13)',
  success: '#33C481',
  danger: '#F05B52',
  dangerBg: 'rgba(240,91,82,0.13)',
  warning: '#F0A33C',
  text: '#F1F4F9',
  textSub: '#96A0B0',
  textMuted: '#5C6779',
};

const redesignLight: Theme = {
  ...lightTheme,
  bg: '#EFF2F7',
  bg2: '#FFFFFF',
  bgText: '#131A28',
  surface: '#FFFFFF',
  surfaceAlt: '#E7EBF2',
  menu: '#FFFFFF',
  menuText: '#9AA6B7',
  border: 'rgba(16,24,40,0.09)',
  accent: '#1F6FEB',
  accentDark: '#1A53C7',
  accentBg: 'rgba(31,111,235,0.09)',
  success: '#17945C',
  danger: '#D9453E',
  dangerBg: 'rgba(217,69,62,0.10)',
  warning: '#B57414',
  text: '#131A28',
  textSub: '#57657A',
  textMuted: '#9AA6B7',
};

/** Tema base por modo, respeitando a flag do redesign. */
export function themeFor(mode: 'dark' | 'light'): Theme {
  if (isRedesign) return mode === 'dark' ? redesignDark : redesignLight;
  return mode === 'dark' ? darkTheme : lightTheme;
}

/** Espaçamento e raios padronizados (8pt-ish). */
export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;
export const space = { xs: 6, sm: 10, md: 14, lg: 18, xl: 24 } as const;
