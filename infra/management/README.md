# Management + Central AjustCam

Stack privada da VM `10.10.0.11`. Ela não substitui a Gateway pública.

Serviços:

- Central AjustCam e PostgreSQL dedicado;
- ingresso interno em `10.10.0.11:8080`, aceitando somente a Gateway `10.10.0.10`;
- Portainer separado em `10.10.0.11:9443`;
- Prometheus, Grafana (`10.10.0.11:3001`), node-exporter, cAdvisor e blackbox-exporter;
- dashboard provisionado com CPU, memória, disco, containers e disponibilidade;
- backup semanal do banco e dos arquivos da Central, com restauração real do
  dump em banco temporário e conferência das tabelas críticas;
- health-check por timer do systemd.

Nenhum banco, socket Docker, Prometheus ou API interna deve receber DNAT público.
Grafana e Portainer devem ser usados por VPN/rede administrativa ou túnel SSH.

## Requisitos iniciais

- Debian 13;
- Docker Engine + Compose;
- 8 GB RAM e 80 GB de disco recomendados para Central + monitoramento;
- clone do repositório em `/opt/ajustcam-management/repo`;
- `.env` modo `0600`, criado a partir de `.env.example` e preenchido por canal seguro.

## Subida controlada

```bash
cd /opt/ajustcam-management/repo/infra/management
docker compose --env-file .env config --quiet
docker compose --env-file .env up -d --build
```

Ative também a verificação administrativa a cada cinco minutos:

```bash
install -m 0644 systemd/ajustcam-management-health.service /etc/systemd/system/
install -m 0644 systemd/ajustcam-management-health.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ajustcam-management-health.timer
```

O primeiro deploy de uma Central existente deve restaurar o PostgreSQL e copiar
o diretório de dados antes de liberar a rota na Gateway.

## Push Android automático (Firebase)

A Central pode registrar automaticamente o pacote Android de cada cliente no
mesmo projeto Firebase e entregar o `google-services.json` correto ao agente de
build. A configuração inicial é feita uma vez:

1. No projeto Firebase do S2Cam, habilite a **Firebase Management API** no
   Google Cloud Console.
2. Crie uma conta de serviço exclusiva, com acesso mínimo para administrar os
   Firebase Apps desse projeto; baixe a chave JSON uma única vez.
3. Na VM Management (a Central executa como UID/GID `1000` dentro do
   contêiner, por isso o arquivo é legível somente por esse usuário):

```bash
install -d -o 1000 -g 1000 -m 0700 /opt/ajustcam-management/secrets/firebase
install -o 1000 -g 1000 -m 0600 /caminho/seguro/service-account.json \
  /opt/ajustcam-management/secrets/firebase/service-account.json
```

4. Defina no `.env` `FIREBASE_PROJECT_ID` e mantenha
   `FIREBASE_SERVICE_ACCOUNT_FILE=/run/secrets/firebase/service-account.json`.
   Rode `docker compose --env-file .env up -d --build central`.

A conta de serviço não é enviada para APK, build-agent, banco ou Git. Ao marcar
“Notificações em segundo plano” no app de um cliente, a Central cria (ou
reaproveita) o pacote no Firebase e só então permite o build. Sem a credencial,
o build é recusado claramente — nunca gera um APK dizendo que possui push sem
possuir.
