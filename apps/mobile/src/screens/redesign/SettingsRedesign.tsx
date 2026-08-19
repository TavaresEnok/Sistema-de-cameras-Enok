/**
 * Ajustes (redesign) — réplica da tela "Ajustes" do mockup: card de perfil, card do
 * provedor/plano (selo Ativo), preferências (tema escuro, notificações de movimento),
 * armazenamento, lista de ações, sair. Ligado ao usuário/tema reais.
 */
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Icon, type IconName } from '../../components/Icon';
import { AddCameraSheet } from '../../components/AddCameraSheet';
import { avaliarAtualizacao, baseDoApk, urlDoBuildInfo, type AtualizacaoDisponivel } from '../../utils/atualizacao';

const TITLE = 'Sora';
const UI = 'InstrumentSans';
const MONO = 'JetBrainsMono';
const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: 'SUPER ADMIN', ADMIN: 'ADMIN', OPERATOR: 'OPERADOR', VIEWER: 'VISUALIZAÇÃO' };

interface Props {
  user: { name?: string | null; email?: string; role?: string } | null;
  apiUrl: string;
  token?: string | null;
  connected: boolean;
  biometricAvailable: boolean;
  biometricEnabled: boolean;
  biometricLabel: string;
  onBiometricChange: (enabled: boolean) => void;
  onLogout: () => void;
  onCamerasChanged?: () => void;
  facilityName?: string;
}

function initials(name?: string | null): string {
  const p = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return (!p.length ? 'U' : (p[0][0] + (p[1]?.[0] ?? ''))).toUpperCase();
}

export function SettingsRedesign(props: Props) {
  const { user, apiUrl, token, connected, biometricAvailable, biometricEnabled, biometricLabel, onBiometricChange, onLogout, onCamerasChanged, facilityName } = props;
  const { theme, themeMode, setThemeMode } = useTheme();
  const [addCameraOpen, setAddCameraOpen] = useState(false);
  const [atualizacao, setAtualizacao] = useState<AtualizacaoDisponivel | null>(null);
  const s = makeStyles(theme);
  const version = Constants.expoConfig?.version ?? '1.0';

  useEffect(() => {
    const slug = String(Constants.expoConfig?.extra?.client ?? 'default');
    const base = baseDoApk(apiUrl);
    if (!base) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(urlDoBuildInfo(base, slug));
        if (!response.ok) return;
        const current = Number(Constants.expoConfig?.android?.versionCode ?? NaN);
        const next = avaliarAtualizacao(await response.json(), current, base);
        if (!cancelled) setAtualizacao(next);
      } catch {
        // Atualização é informativa; ficar offline não deve bloquear Ajustes.
      }
    })();
    return () => { cancelled = true; };
  }, [apiUrl]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={s.root} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>Ajustes</Text>

        {/* Perfil */}
        <View style={s.card}>
          <View style={s.avatar}><Text style={s.avatarText}>{initials(user?.name)}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.profileName} numberOfLines={1}>{user?.name || 'Usuário'}</Text>
            <Text style={s.profileEmail} numberOfLines={1}>{user?.email || '—'}</Text>
          </View>
          {user?.role ? <Text style={s.roleBadge}>{ROLE_LABEL[user.role] ?? user.role}</Text> : null}
        </View>

        {/* Provedor: só aparece quando HÁ nome real da instalação.
            O fallback era o literal "Grupo Flash" — e como o App nunca passava
            `facilityName`, TODO build white-label mostrava o nome de outro
            cliente, com um selo "Ativo" que não vinha de dado nenhum. */}
        {facilityName ? (
          <View style={[s.card, { marginTop: 12 }]}>
            <View style={s.providerIcon}><Icon name="server" size={18} color={theme.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.providerName}>{facilityName}</Text>
              <Text style={s.providerSub}>Instalação conectada</Text>
            </View>
          </View>
        ) : null}

        {/* Configuração */}
        <Text style={s.section}>Configuração</Text>
        <View style={s.group}>
          <View style={s.themeOptions} accessibilityRole="radiogroup">
            {([
              { id: 'system' as const, label: 'Sistema', icon: 'settings' as const },
              { id: 'dark' as const, label: 'Escuro', icon: 'moon' as const },
              { id: 'light' as const, label: 'Claro', icon: 'sun' as const },
            ]).map((option) => {
              const selected = themeMode === option.id;
              return (
                <TouchableOpacity
                  key={option.id}
                  accessibilityRole="radio"
                  accessibilityLabel={`Tema ${option.label.toLowerCase()}`}
                  accessibilityState={{ checked: selected }}
                  style={[s.themeOption, selected && { backgroundColor: theme.accentBg, borderColor: theme.accent }]}
                  onPress={() => setThemeMode(option.id)}
                >
                  <Icon name={option.icon} size={16} color={selected ? theme.accent : theme.textSub} />
                  <Text style={[s.themeOptionText, { color: selected ? theme.accent : theme.textSub }]}>{option.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {biometricAvailable ? (
            <>
              <View style={s.divider} />
              <Prefs theme={theme} s={s} icon="lock" label={`Entrar com ${biometricLabel}`} value={biometricEnabled} onChange={onBiometricChange} />
            </>
          ) : null}
        </View>

        {/* Minhas câmeras — cadastro de câmera privada do próprio cliente (LGPD). */}
        <Text style={s.section}>Minhas câmeras</Text>
        <View style={s.group}>
          <Item theme={theme} s={s} icon="plus" label="Adicionar câmera" subtitle="Busca automática, QR Code ou endereço" onPress={() => setAddCameraOpen(true)} />
        </View>

        {atualizacao ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Baixar nova versão ${atualizacao.versionName}`}
            style={[s.updateCard, { borderColor: theme.accent }]}
            onPress={() => { void Linking.openURL(atualizacao.url); }}
          >
            <View style={[s.prefIcon, { backgroundColor: theme.accentBg }]}><Icon name="download" size={17} color={theme.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.updateTitle}>Atualização disponível</Text>
              <Text style={s.updateText}>Versão {atualizacao.versionName} · toque para instalar</Text>
            </View>
            <Icon name="forward" size={16} color={theme.accent} />
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Sair da conta" style={s.logout} activeOpacity={0.85} onPress={onLogout}>
          <Icon name="logout" size={18} color={theme.danger} />
          <Text style={s.logoutText}>Sair da conta</Text>
        </TouchableOpacity>

        <View style={s.footer} accessibilityLiveRegion="polite" accessibilityLabel={connected ? `Servidor conectado. Versão ${version}` : `Sem conexão com o servidor. Versão ${version}`}>
          <View style={[s.statusDot, { backgroundColor: connected ? theme.success : theme.danger }]} />
          <Text style={s.footerText}>{connected ? 'servidor conectado' : 'sem conexão'} · v{version}</Text>
        </View>
      </ScrollView>

      <AddCameraSheet
        visible={addCameraOpen}
        apiUrl={apiUrl}
        token={token ?? null}
        onClose={() => setAddCameraOpen(false)}
        onCreated={onCamerasChanged}
      />
    </View>
  );
}

function Prefs({ theme, s, icon, label, value, onChange }: { theme: any; s: any; icon: IconName; label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={s.pref}>
      <View style={s.prefIcon}><Icon name={icon} size={17} color={theme.textSub} /></View>
      <Text style={s.prefLabel}>{label}</Text>
      <Switch
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityState={{ checked: value }}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: theme.accent, false: theme.surfaceAlt }}
        thumbColor="#fff"
      />
    </View>
  );
}

function Item({ theme, s, icon, label, subtitle, onPress }: { theme: any; s: any; icon: IconName; label: string; subtitle?: string; onPress?: () => void }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} style={s.pref} activeOpacity={0.7} onPress={onPress}>
      <View style={s.prefIcon}><Icon name={icon} size={17} color={theme.textSub} /></View>
      <View style={{ flex: 1 }}><Text style={[s.prefLabel, { flex: 0 }]}>{label}</Text>{subtitle ? <Text style={s.itemSubtitle}>{subtitle}</Text> : null}</View>
      <Icon name="forward" size={16} color={theme.textMuted} />
    </TouchableOpacity>
  );
}

function makeStyles(t: any) {
  return StyleSheet.create({
    root: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 132 },
    title: { fontFamily: TITLE, fontSize: 26, fontWeight: '800', color: t.text, letterSpacing: -0.5, marginBottom: 16 },
    card: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: 18, padding: 15 },
    avatar: { width: 50, height: 50, borderRadius: 16, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontFamily: TITLE, fontSize: 17, fontWeight: '700', color: '#fff' },
    profileName: { fontFamily: TITLE, fontSize: 17, fontWeight: '700', color: t.text },
    profileEmail: { fontFamily: UI, fontSize: 13, color: t.textSub, marginTop: 2 },
    roleBadge: { fontFamily: MONO, fontSize: 9.5, fontWeight: '600', color: t.accent, backgroundColor: t.accentBg, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, overflow: 'hidden' },
    providerIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: t.accentBg, alignItems: 'center', justifyContent: 'center' },
    providerName: { fontFamily: UI, fontSize: 15, fontWeight: '700', color: t.text },
    providerSub: { fontFamily: UI, fontSize: 12.5, color: t.textSub, marginTop: 2 },
    activeBadge: { backgroundColor: 'rgba(51,196,129,0.16)', paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999 },
    activeText: { fontFamily: UI, fontSize: 12, fontWeight: '700', color: t.success },

    section: { fontFamily: MONO, fontSize: 11, fontWeight: '600', letterSpacing: 1, color: t.textMuted, marginTop: 24, marginBottom: 10, marginLeft: 2 },
    group: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: 18, overflow: 'hidden' },
    themeOptions: { flexDirection: 'row', gap: 8, padding: 10 },
    themeOption: { flex: 1, minHeight: 42, borderWidth: 1, borderColor: t.border, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: t.surfaceAlt },
    themeOptionText: { fontFamily: UI, fontSize: 12, fontWeight: '700' },
    pref: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 15, paddingVertical: 14 },
    prefIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
    prefLabel: { flex: 1, fontFamily: UI, fontSize: 14.5, fontWeight: '500', color: t.text },
    itemSubtitle: { fontFamily: UI, fontSize: 11.5, color: t.textSub, marginTop: 2 },
    divider: { height: 1, backgroundColor: t.border, marginLeft: 62 },

    logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 24, height: 54, borderRadius: 16, borderWidth: 1, borderColor: t.dangerBg, backgroundColor: t.dangerBg },
    logoutText: { fontFamily: UI, fontSize: 15, fontWeight: '700', color: t.danger },
    updateCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.surface, borderWidth: 1, borderRadius: 16, padding: 13, marginTop: 18 },
    updateTitle: { fontFamily: UI, fontSize: 14, fontWeight: '700', color: t.text },
    updateText: { fontFamily: UI, fontSize: 11.5, color: t.textSub, marginTop: 2 },
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 22 },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    footerText: { fontFamily: MONO, fontSize: 11, color: t.textMuted },
  });
}
