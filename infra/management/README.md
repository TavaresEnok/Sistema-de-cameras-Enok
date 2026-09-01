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
