import axios from 'axios';
import { create } from 'zustand';
import { getApiBaseUrl } from '../lib/api-base';
import { buildBrandColorCss } from '../lib/brand-colors';
import { normalizeFacilityName, PRODUCT_NAME } from '../lib/product-brand';

type PublicBranding = {
  facilityName?: string;
  brandLogoDataUrl?: string;
  brandUseDefaultColors?: boolean;
  // Paleta escura (chaves sem prefixo).
  brandPrimaryColor?: string;
  brandButtonTextColor?: string;
  brandBackgroundColor?: string;
  brandBackgroundTextColor?: string;
  brandSecondaryColor?: string; // superfície de card/painel
  brandPrimaryTextColor?: string; // texto sobre a superfície
  brandSecondaryTextColor?: string; // subtexto sobre a superfície
  brandBorderColor?: string;
  // Paleta clara (chaves com prefixo Light).
  brandLightPrimaryColor?: string;
  brandLightButtonTextColor?: string;
  brandLightBackgroundColor?: string;
  brandLightBackgroundTextColor?: string;
  brandLightSecondaryColor?: string;
  brandLightPrimaryTextColor?: string;
  brandLightSecondaryTextColor?: string;
  brandLightBorderColor?: string;
  // Feature flag (não é marca): a página de IA aparece no menu? Por instalação.
  aiFeatureEnabled?: boolean;
  // Caminhos escondidos do menu NESTA instalação (separados por vírgula).
  hiddenNavPaths?: string;
};

type BrandingState = {
  facilityName: string;
  logoDataUrl: string;
  aiFeatureEnabled: boolean;
  hiddenNavPaths: string[];
  loaded: boolean;
  load: () => Promise<void>;
};

// Injeta/remove um <style> que sobrescreve o accent (primary/ring) do tema com a
// cor do cliente. Só age quando há cor válida e o cliente não usa a paleta padrão;
// caso contrário remove o override (DRAC padrão intocado).
function applyBrandColors(data: PublicBranding) {
  if (typeof document === 'undefined') return;
  const css = buildBrandColorCss({
    useDefaultColors: data.brandUseDefaultColors,
    // Escuro → bloco .dark
    primaryColor: data.brandPrimaryColor,
    buttonTextColor: data.brandButtonTextColor,
    backgroundColor: data.brandBackgroundColor,
    backgroundTextColor: data.brandBackgroundTextColor,
    surfaceColor: data.brandSecondaryColor,
    textColor: data.brandPrimaryTextColor,
    textSubColor: data.brandSecondaryTextColor,
    borderColor: data.brandBorderColor,
    // Claro → bloco :root
    lightPrimaryColor: data.brandLightPrimaryColor,
    lightButtonTextColor: data.brandLightButtonTextColor,
    lightBackgroundColor: data.brandLightBackgroundColor,
    lightBackgroundTextColor: data.brandLightBackgroundTextColor,
    lightSurfaceColor: data.brandLightSecondaryColor,
    lightTextColor: data.brandLightPrimaryTextColor,
    lightTextSubColor: data.brandLightSecondaryTextColor,
    lightBorderColor: data.brandLightBorderColor,
  });
  const id = 'drac-brand-colors';
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!css) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

export const useBrandingStore = create<BrandingState>((set) => ({
  facilityName: PRODUCT_NAME,
  logoDataUrl: '',
  // Default FALSE: enquanto o servidor não responde, a página de IA fica
  // escondida. Uma instalação sem IA nunca deve piscar o item no menu.
  aiFeatureEnabled: false,
  hiddenNavPaths: [],
  loaded: false,
  load: async () => {
    try {
      const { data } = await axios.get<PublicBranding>(`${getApiBaseUrl()}/settings/branding`, { timeout: 8_000 });
      set({
        facilityName: normalizeFacilityName(data.facilityName),
        logoDataUrl: data.brandLogoDataUrl?.trim() || '',
        aiFeatureEnabled: data.aiFeatureEnabled === true,
        // "/alarms,/review" → ['/alarms','/review']. Vazio = nada escondido.
        hiddenNavPaths: String(data.hiddenNavPaths ?? '').split(',').map((p) => p.trim()).filter(Boolean),
        loaded: true,
      });
      applyBrandColors(data);
    } catch {
      set((state) => ({ ...state, loaded: true }));
    }
  },
}));
