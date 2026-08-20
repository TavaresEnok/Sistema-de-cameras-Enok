# DRAC Mobile

Aplicativo Android inicial do DRAC, construido com Expo/React Native para reaproveitar a mesma API e a mesma separacao interna por grupos do sistema web.

## Rodar para teste

```bash
corepack pnpm --filter mobile start:lan
```

Abra o link/QR no Expo Go no Android. A URL padrao da API pode ser alterada na tela de login para o IP ou dominio da instalacao.

Builds de produção exigem HTTPS. Para uma instalação local de desenvolvimento
que ainda use HTTP, gere o app explicitamente com `ALLOW_CLEARTEXT_TRAFFIC=true`.

## Funcionalidades iniciais

- Login com o JWT da API atual.
- Dashboard com cameras ja filtradas pelo backend conforme grupos/permissoes.
- Ao vivo por HLS quando MediaMTX publicar `hlsUrl`.
- Grid mobile com 1, 2 ou 4 cameras.
- PTZ por camera quando a API retornar permissao `canControl`.
- Gravacao manual quando a API retornar permissao `canRecord`.
- Playback com gravacoes do dia, abrir video e baixar/compartilhar MP4.
- Alarme/relay apenas quando `/ptz/:cameraId/relays` retornar saida acionavel.
- Cadastro privado por RTMP push ou RTSP pull, com descoberta local por ONVIF,
  mDNS, SSDP e busca limitada à sub-rede privada do telefone.
- Edição e exclusão da câmera privada pelo proprietário, com limpeza do acervo
  e confirmação antes da ação destrutiva.

## Limite atual do provisionamento Wi-Fi

O app encontra e configura câmeras que já entraram na rede. Enviar SSID e senha
diretamente a uma câmera zerada ainda exige driver/SDK oficial homologado por
fabricante e modelo (por exemplo, Intelbras ou Tuya/Positivo). A tela móvel não
simula esse pareamento: enquanto não houver o SDK, orienta o primeiro vínculo no
aplicativo do fabricante e depois assume descoberta, vídeo e cadastro.

## Android nativo

Para gerar APK/AAB local depois de validar no Expo Go:

```bash
corepack pnpm --filter mobile exec expo prebuild --platform android
cd apps/mobile/android
./gradlew assembleDebug
```

O APK debug fica em `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
