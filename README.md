# Vimeo → YouTube Migrator (Oracle) + WordPress Update (ACF)

Script em Node.js para migração gradual de vídeos do Vimeo para YouTube, com atualização automática no WordPress.

## ✨ Funcionalidades

1. **Busca no WordPress**: Consulta posts candidatos via endpoint custom (`migrate/v1/vimeo-candidates`)
2. **Download do Vimeo**: Baixa MP4 via API com medição de velocidade
3. **Upload no YouTube**: Upload resumable com metadados preservados (título, descrição)
4. **Atualização WordPress**: Atualiza campo ACF/meta com URL no formato `https://youtu.be/<id>`
5. **Controle de Fila**: SQLite persistente permite retomar migração após interrupções
6. **Rate Limiting por Quota**: Controle automático de quota YouTube API (10.000 unidades/dia)
7. **Métricas**: Velocidade de download/upload com progresso em tempo real
8. **Relatórios**: CSV de mapeamento Vimeo→YouTube por ambiente
9. **Cleanup**: Remove arquivos locais após sucesso (opcional)

## 🎯 Ideal para

- VMs gratuitas (Oracle Cloud) com banda limitada
- Contas YouTube com quota API restrita (10.000 unidades/dia = ~6 uploads)
- Migrações graduais que podem durar vários dias
- Processamento sequencial (CONCURRENCY=1) para não sobrecarregar recursos

---

## 📋 Requisitos

- Node.js 18+ (recomendado 20+)
- Acesso Vimeo API token com permissão de ler vídeo e obter link MP4
- Google OAuth 2.0 Client (YouTube Data API v3 habilitada) + Refresh Token
- WordPress com:
  - Application Password habilitado para um usuário com permissão de editar
  - MU-plugin com endpoints:
    - `GET /wp-json/migrate/v1/vimeo-candidates`
    - `POST /wp-json/migrate/v1/update-youtube`
  - Campos ACF:
    - Vimeo: `url_do_video_full`
    - YouTube: `url_do_youtube` (deve ter `show_in_rest: true`)

---

## 🚀 Instalação

```bash
# Clone o repositório
git clone <repo-url>
cd vimeo2yt-migrator

# Instale dependências
npm install

# Configure variáveis de ambiente
cp env.example .env.qa   # Para ambiente QA
cp env.example .env.prod # Para ambiente Produção

# Edite os arquivos .env com suas credenciais
```

---

## ⚙️ Configuração (.env)

### Variáveis Obrigatórias

| Variável | Descrição |
|----------|-----------|
| `APP_ENV` | Ambiente (qa/prod) |
| `DB_PATH` | Caminho do SQLite (ex: `./data/jobs.qa.sqlite`) |
| `TMP_DIR` | Diretório temporário para downloads |
| `LOG_FILE` | Arquivo de log (ex: `./logs/worker.qa.log`) |
| `VIMEO_TOKEN` | Token de acesso Vimeo API |
| `YT_CLIENT_ID` | Client ID do Google OAuth |
| `YT_CLIENT_SECRET` | Client Secret do Google OAuth |
| `YT_REDIRECT_URI` | Redirect URI (ex: `http://localhost`) |
| `YT_REFRESH_TOKEN` | Refresh Token do YouTube |
| `WP_BASE_URL` | URL do WordPress |
| `WP_APP_USER` | Usuário WordPress |
| `WP_APP_PASS` | Application Password do WordPress |
| `WP_MIGRATE_TOKEN` | Token custom para endpoints de migração |

### Variáveis Opcionais (Rate Limiting)

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `YT_DAILY_QUOTA_LIMIT` | `10000` | Limite diário de quota YouTube API |
| `YT_PRIVACY_STATUS` | `unlisted` | Privacidade dos vídeos (unlisted/public/private) |
| `BATCH_SIZE` | `20` | Posts por página na busca WordPress |
| `CONCURRENCY` | `1` | Paralelismo (recomendado: 1 para VMs gratuitas) |
| `MAX_ATTEMPTS` | `5` | Tentativas por job antes de marcar como falha |
| `CLEANUP_OK` | `0` | Remove arquivos locais após sucesso (1=ativo) |
| `FETCH_MAX_PAGES` | `0` | Limite de páginas (0=ilimitado) |

---

## 🎮 Uso

### 1. Buscar candidatos no WordPress

```bash
# QA
npm run fetch:qa

# Produção
npm run fetch:prod

# Forçar reprocessamento de já migrados
npm run fetch:qa -- --force
```

### 2. Executar migração (download + upload + update)

```bash
# QA
npm run migrate:qa

# Produção
npm run migrate:prod
```

O worker irá:
- Processar um vídeo por vez (sequencial)
- Verificar quota YouTube antes de cada upload
- Parar automaticamente quando atingir o limite diário
- Mostrar status da quota: `QUOTA STATUS: 2/6 uploads today (3200/10000 units)`

### 3. Verificar status

```bash
npm run status:qa
# ou
npm run status:prod
```

Mostra contagem de jobs por status:
```json
{ "queued": 10, "downloading": 0, "uploading": 0, "done": 5, "failed": 2 }
```

---

## 📊 Rate Limiting e Quota

### Como funciona

1. **Cálculo automático**: `maxUploadsPerDay = quotaLimit / uploadCost`
   - Padrão: 10.000 / 1.600 = **6 uploads por dia**

2. **Persistência**: Contador armazenado no SQLite (`quota_tracking` table)

3. **Auto-reset**: Contador reseta automaticamente quando muda o dia

4. **Parada inteligente**: Worker para ANTES de atingir o limite

### Exemplo de log

```
[2024-01-15T10:30:00Z] QUOTA STATUS: 2/6 uploads today (3200/10000 units)
[2024-01-15T10:30:00Z] JOB 123 post=456 vimeo=789 attempt=1
[2024-01-15T10:35:00Z] DONE job=123 => https://youtu.be/abc123

... (após 6 uploads) ...

[2024-01-15T14:20:00Z] QUOTA EXHAUSTED: 6/6 uploads today (9600/10000 units)
[2024-01-15T14:20:00Z] Stopping worker to preserve YouTube API quota. Resume tomorrow.
```

### Ajustando a quota

Se sua conta tiver quota diferente:

```bash
# .env.prod
YT_DAILY_QUOTA_LIMIT=50000  # Permite ~31 uploads/dia
```

---

## 🗄️ Estrutura do SQLite

### Tabela `jobs`

| Campo | Descrição |
|-------|-----------|
| `id` | ID auto-increment |
| `wp_post_id` | ID do post no WordPress |
| `vimeo_url` | URL original do Vimeo |
| `vimeo_id` | ID do vídeo Vimeo |
| `status` | queued/downloading/uploading/updating_wp/done/failed |
| `attempts` | Número de tentativas |
| `local_path` | Caminho do arquivo baixado |
| `file_size_bytes` | Tamanho do arquivo |
| `youtube_id` | ID do vídeo no YouTube |
| `youtube_url` | URL do YouTube (youtu.be) |
| `error` | Mensagem de erro (se falhou) |
| `created_at` | Data de criação |
| `updated_at` | Última atualização |

### Tabela `quota_tracking`

| Campo | Descrição |
|-------|-----------|
| `upload_count` | Uploads realizados hoje |
| `quota_used` | Unidades de quota consumidas |
| `date` | Data atual (YYYY-MM-DD) |
| `updated_at` | Última atualização |

---

## 📁 Arquivos Gerados

```
./
├── data/
│   ├── jobs.qa.sqlite       # Banco de dados QA
│   ├── jobs.prod.sqlite     # Banco de dados Produção
│   ├── mapping.qa.csv       # Relatório de mapeamento QA
│   └── mapping.prod.csv     # Relatório de mapeamento Produção
├── logs/
│   ├── worker.qa.log        # Logs de execução QA
│   └── worker.prod.log      # Logs de execução Produção
└── tmp/
    └── vimeo_*.mp4          # Arquivos temporários (removidos após upload)
```

---

## 🔧 Comandos Úteis

### Obter Refresh Token do YouTube

```bash
node get-refresh-token.js
# Siga as instruções para autenticar e obter o token
```

### Testar conexão YouTube

```bash
node src/yt-smoke.js
# Deve listar informações do seu canal
```

### Resetar contador de quota (emergência)

```sql
-- Execute no SQLite browser ou CLI
UPDATE quota_tracking SET upload_count = 0, quota_used = 0 WHERE id = 1;
```

---

## 🐛 Troubleshooting

### "Quota exceeded" erro 403

- Verifique `YT_DAILY_QUOTA_LIMIT` no .env
- Aguarde até amanhã ou aumente o limite se tiver quota disponível
- Verifique uso real em: https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas

### Upload falha após download completo

- O job retomará automaticamente do ponto de falha
- Se o upload foi feito mas WP não atualizou, o sistema detecta e tenta apenas o update

### "No download links available" do Vimeo

- Verifique se o token Vimeo tem permissão `video_files`
- Alguns vídeos podem ter restrições de download

### WordPress retorna 401/403

- Verifique `WP_APP_USER` e `WP_APP_PASS` (Application Password, não senha normal)
- Confirme que o endpoint custom está ativo no WordPress

---

## 📝 Notas

- **Processamento sequencial**: Por padrão `CONCURRENCY=1` para não sobrecarregar VMs gratuitas
- **Resumível**: Pode parar e retomar a qualquer momento sem perder progresso
- **Idempotente**: Não cria duplicatas se executar fetch múltiplas vezes
- **Seguro**: Só atualiza WordPress após upload confirmado no YouTube

---

## 📄 Licença

MIT
