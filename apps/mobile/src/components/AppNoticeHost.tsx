import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dismissAppNotice, subscribeAppNotice, type AppNotice } from '../services/app-notice';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';

export function AppNoticeHost() {
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => subscribeAppNotice(setNotice), []);
  useEffect(() => {
    if (!notice || notice.durationMs <= 0) return;
    const timer = setTimeout(() => dismissAppNotice(notice.id), notice.durationMs);
    return () => clearTimeout(timer);
  }, [notice?.id]);

  if (!notice) return null;
  const color = notice.tone === 'success' ? theme.success
    : notice.tone === 'warning' ? theme.warning
      : notice.tone === 'error' ? theme.danger
        : theme.accent;
  const icon = notice.tone === 'success' ? 'check'
    : notice.tone === 'warning' || notice.tone === 'error' ? 'alert'
      : 'info';

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: Math.max(12, insets.top + 8) }]}>
      <Pressable
        accessibilityRole="alert"
        accessibilityLabel={`${notice.title}. ${notice.message}`}
        onPress={() => dismissAppNotice(notice.id)}
        style={[styles.card, { backgroundColor: theme.surface, borderColor: color }]}
      >
        <View style={[styles.icon, { backgroundColor: theme.surfaceAlt }]}>
          <Icon name={icon} size={18} color={color} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: theme.text }]}>{notice.title}</Text>
          {notice.message ? <Text style={[styles.message, { color: theme.textSub }]}>{notice.message}</Text> : null}
        </View>
        <Icon name="close" size={15} color={theme.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 14, right: 14, zIndex: 10000, elevation: 30, alignItems: 'center' },
  card: { width: '100%', maxWidth: 620, minHeight: 66, borderRadius: 17, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 11, shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 20 },
  icon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  title: { fontFamily: 'InstrumentSans', fontSize: 14.5, fontWeight: '800' },
  message: { fontFamily: 'InstrumentSans', fontSize: 12.5, lineHeight: 17, marginTop: 2 },
});
