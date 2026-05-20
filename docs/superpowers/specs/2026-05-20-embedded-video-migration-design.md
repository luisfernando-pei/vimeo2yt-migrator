# Design — Migração de vídeos do Vimeo embedados no conteúdo das matérias

**Data:** 2026-05-20
**Status:** Aprovado (design) — aguardando plano de implementação

## Contexto

O migrador atual (`vimeo2yt-migrator`) já concluiu a migração de toda a seção
**Play**, onde cada vídeo do Vimeo fica num campo ACF dedicado (`url_do_video_full`)
e a URL do YouTube é gravada em outro campo ACF (`url_do_youtube`).

Agora existe um segundo caso: matérias comuns que têm **vídeos do Vimeo embedados
direto no corpo do conteúdo** (`post_content`), dentro de um bloco `<iframe>`. Não
há campo específico — o vídeo está no meio do HTML da matéria.

Exemplo do bloco encontrado no conteúdo:

```html
<div style="padding: 56.25% 0 0 0; position: relative;"><iframe style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" title="EP_TBOL_MARCELLO DANTAS_V3" src="https://player.vimeo.com/video/1110143545?badge=0&amp;autopause=0&amp;player_id=0&amp;app_id=58479" frameborder="0" data-mce-fragment="1"></iframe></div>
<script src="https://player.vimeo.com/api/player.js"></script>
```

## Objetivo

Construir um **CLI separado** que:

1. Encontre as matérias com vídeos do Vimeo embedados no `post_content`.
2. Extraia o ID de cada vídeo.
3. Verifique se o vídeo já foi subido ao YouTube (dedup).
4. Suba ao YouTube os que ainda não foram.
5. Reescreva o `post_content` trocando o iframe do Vimeo pelo embed do YouTube.

## Fora de escopo

- Migração da seção Play (já concluída).
- Alterar o fluxo/CLI existente (`src/cli.js` e módulos da Play permanecem intactos).
- Reescrita de embeds de outros provedores que não o Vimeo.

## Decisões tomadas no brainstorming

| # | Decisão | Escolha |
|---|---------|---------|
| 1 | Dedup quando o mesmo vídeo aparece em vários lugares | **Reusar de tudo que já existe** — checa o `vimeo_id` contra a migração da Play E contra os vídeos já processados nesta rodada; se houver YouTube correspondente, só troca o iframe, sem re-upload |
| 2 | Como reescrever o bloco no conteúdo | **Trocar só o iframe, manter o wrapper** — mantém a `<div>` responsiva (padding 56.25%), troca o `src` para o YouTube, remove a linha do `<script>` do `player.vimeo.com` |
| 3 | Controle de execução | **Duas fases: `scan` → `migrate`**, com `--dry-run` e `--limit=N` |
| 4 | Título do vídeo no YouTube | **Nome do vídeo no Vimeo** (campo `name` da API). Fallback: título da matéria; depois `Video <vimeoId>` |

## Abordagem escolhida

**Abordagem A** — Endpoints novos no plugin WordPress + CLI novo reusando os módulos
core. Descartadas:

- **B (WP REST API padrão):** o `search` do WP é busca tokenizada e não acha
  `player.vimeo.com` de forma confiável; e atualizar `content` via REST passa pelo
  `kses`, que estriparia o `<iframe>`.
- **C (script 100% standalone):** duplicaria `youtube.js`/`vimeo.js`, criando duas
  cópias para manter.

## Arquitetura

CLI separado, **reusando os módulos testados** do projeto.

### Arquivos novos (`src/`)

| Arquivo | Responsabilidade |
|---------|------------------|
| `embed-cli.js` | Entrypoint. Comandos: `scan`, `migrate`, `status` |
| `embed-wordpress.js` | Cliente dos 2 endpoints novos (listar candidatos / gravar conteúdo) |
| `embed-scanner.js` | Acha os iframes do Vimeo no conteúdo, extrai os IDs |
| `embed-rewriter.js` | **Função pura:** recebe conteúdo + mapa `{vimeoId→youtubeId}`, devolve conteúdo novo |
| `embed-db.js` | Abre o mesmo `jobs.prod.sqlite`, gerencia as tabelas novas e o dedup |
| `embed-worker.js` | Loop da fase `migrate` |

### Reusados sem alteração

`vimeo.js`, `youtube.js`, `logger.js`, `metrics.js`, `config.js`, `report.js`.

### Alteração mínima

`constants.js`: adicionar o regex `PLAYER_VIMEO_ID = /player\.vimeo\.com\/video\/(\d+)/`.
O `Patterns.VIMEO_ID` atual (`/vimeo\.com\/(\d+)/`) **não** casa URLs de player
(`player.vimeo.com/video/ID`).

### Scripts npm

```
embed:scan:prod    → NODE_ENV=prod node src/embed-cli.js scan
embed:migrate:prod → NODE_ENV=prod node src/embed-cli.js migrate
embed:status:prod  → NODE_ENV=prod node src/embed-cli.js status
```

O `.env.prod` atual serve sem mudança (mesmas credenciais Vimeo/YT/WP).

## Alterações no plugin WordPress

O plugin sobe para **v2.2.0**. Os 2 endpoints atuais (`vimeo-candidates`,
`update-youtube`) permanecem intactos. Dois endpoints novos:

### `GET /wp-json/migrate/v1/embed-candidates`

- **Params:** `per_page`, `page`, e opcional `post_id` (busca uma matéria só —
  usado pelo `migrate` para rebuscar conteúdo fresco).
- **Query:** `post_content LIKE '%player.vimeo.com/video/%'` via `$wpdb` direto
  (o `WP_Query` não faz LIKE em conteúdo de forma confiável), com `LIMIT/OFFSET`.
- **Retorno por item:** `id`, `title`, `post_url`, `post_date`, e o `content` raw
  (o `post_content` exato, sem limpeza — o HTML original é necessário para a
  cirurgia).
- **Auth:** `X-Migrate-Token` (igual aos endpoints existentes).

### `POST /wp-json/migrate/v1/update-content`

- **Body:** `{ post_id, content }`.
- **Gravação:** o `post_content` novo precisa ser gravado **driblando o kses**. O
  `wp_update_post` normal passa pelo `wp_filter_post_kses`, que estriparia o
  `<iframe>` (iframe não está na lista permitida do kses). Solução:
  `kses_remove_filters()` antes do update, `wp_update_post`, `kses_init_filters()`
  depois.
- **Retorno:** `{ ok, post_id }`.

A lógica de reescrita do HTML fica no Node (`embed-rewriter.js`), testável com
unit tests. O endpoint só persiste o conteúdo pronto.

## Modelo de dados

Duas tabelas novas no **mesmo** `jobs.prod.sqlite`:

```sql
-- Fila de trabalho: 1 linha por matéria
CREATE TABLE IF NOT EXISTS embed_posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  wp_post_id  INTEGER NOT NULL UNIQUE,
  title       TEXT,
  post_url    TEXT,
  post_date   TEXT,
  status      TEXT NOT NULL DEFAULT 'queued',  -- queued/processing/done/failed/no_videos
  attempts    INTEGER NOT NULL DEFAULT 0,
  video_count INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Livro-razão de dedup: 1 linha por vídeo único migrado nesta rodada
CREATE TABLE IF NOT EXISTS video_map (
  vimeo_id       TEXT PRIMARY KEY,
  youtube_id     TEXT NOT NULL,
  youtube_url    TEXT NOT NULL,
  vimeo_name     TEXT,
  source_post_id INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Resolução de dedup

Dado um `vimeo_id`, na ordem:

1. `video_map` → já migrado nesta rodada de embedados? reusa.
2. Tabela `jobs` (migração da Play) onde `youtube_url` existe → reusa, e copia
   para o `video_map`.
3. Sem hit → baixa + sobe, insere no `video_map`.

## Fluxo das duas fases

### Fase `scan` (não altera nada em produção)

1. Pagina o `embed-candidates`; faz upsert em `embed_posts` (1 linha/matéria,
   com `video_count` contado a partir do conteúdo).
2. Gera um **CSV de pré-visualização**: por matéria → quais `vimeo_id`, quantos já
   têm YouTube (dedup), quantos precisam subir.
3. Imprime o resumo: X matérias, Y vídeos, Z únicos, W para subir.

### Fase `migrate` (`--dry-run` e `--limit=N`)

Seleciona matérias com `status` em (`queued`, `failed`) e `attempts < MAX_ATTEMPTS`,
mais antiga primeiro (`post_date ASC`, igual à Play). Por matéria:

1. Incrementa `attempts` e marca `embed_posts` como `processing`.
2. **Rebusca o conteúdo fresco** da matéria (`embed-candidates?post_id=N`) —
   evita gravar em cima de algo desatualizado.
3. Parseia os iframes → lista de `vimeo_id`. Se a matéria não tiver mais nenhum
   iframe do Vimeo (ex: editada entre o `scan` e o `migrate`), marca `no_videos`
   e segue para a próxima.
4. Para cada `vimeo_id` sem YouTube resolvido:
   - Resolve por dedup;
   - Se faltar: baixa (`downloadVimeoToFile`) + sobe (`uploadToYouTube`, título =
     `name` do Vimeo) + grava no `video_map`; limpa o arquivo tmp.
5. **Só quando todos os vídeos da matéria têm YouTube:** chama o `embed-rewriter`,
   valida o resultado, e grava via `update-content`.
6. Marca `embed_posts` como `done`.

**Segurança no passo 5:** se qualquer vídeo da matéria falhar, a matéria **não é
gravada** — fica `failed` e tenta de novo depois. Os vídeos que já subiram ficam
no `video_map`, então o retry não re-sobe nada. Nunca existe matéria com metade
dos vídeos trocados.

## O rewriter (`embed-rewriter.js`)

Função pura. Recebe `post_content` raw + mapa `{vimeoId→youtubeId}`, devolve o
conteúdo novo. Duas passadas:

1. **Troca cada iframe do Vimeo.** Para cada `<iframe>` com `src` casando
   `player.vimeo.com/video/<id>`: mantém a `<div>` wrapper (padding 56.25%) e a
   `style` do iframe; reconstrói o iframe com
   `src="https://www.youtube.com/embed/<youtubeId>"`, `frameborder="0"`,
   `allowfullscreen`. Descarta o que é específico do Vimeo (`title` = nome do
   arquivo, `data-mce-fragment`, params `app_id`/`badge`).
2. **Remove os `<script src="...player.vimeo.com/api/player.js"></script>`**
   soltos (o YouTube não precisa).

### Validação pós-rewrite (antes de gravar)

O conteúdo novo **não pode** conter `player.vimeo.com/video/` dos IDs resolvidos,
e **tem que** conter os `youtube.com/embed/` esperados. Se a asserção falhar →
aborta a matéria, marca `failed`, não grava.

### Idempotência

Depois de migrada, a matéria não tem mais `player.vimeo.com` → um novo `scan` não
a recolhe. Seguro reexecutar.

## Tratamento de erros

Mesma filosofia da Play (`MAX_ATTEMPTS`, retry).

| Falha | Comportamento |
|-------|---------------|
| Download Vimeo falha / sem links | Matéria `failed`, retry. Vídeos OK já estão no `video_map` |
| Upload YouTube falha (quota 403, etc.) | Matéria `failed`, retry; em erro de quota, recomenda parar |
| `update-content` falha | Vídeos já no `video_map` → retry só refaz rewrite + gravação, sem re-upload |
| Iframe Vimeo em formato não reconhecido | Matéria não é gravada, marcada `failed` com nota para inspeção manual |

### Quota

O `worker.js` da Play **não chega a aplicar** o controle de quota (a tabela
`quota_tracking` está vazia, o worker nunca a consulta). Na prática o que controla
é o `--limit=N`. O migrador de embedados segue o mesmo: throttling por `--limit=N`,
sem tabela de quota. Mesma conta YouTube, mesmos ~6 uploads/dia úteis no padrão.

### Privacidade dos vídeos

`unlisted` (padrão atual, `YT_PRIVACY_STATUS` no `.env.prod`). Vídeos precisam ser
`unlisted` ou `public` para poderem ser embedados — `private` não embeda.

## Testes

- **Unit tests do `embed-rewriter.js`** — fixtures com os 3 exemplos reais
  fornecidos + casos de borda: matéria com 2+ vídeos, iframe multilinha, params
  variados na URL, conteúdo sem vídeo.
- **Unit test do parser** de `vimeo_id` a partir de `player.vimeo.com`.
- **`--dry-run`** para ensaio end-to-end sem gravar.
- **`--limit=1`** no primeiro run real, numa matéria só, para conferir o resultado
  no site antes de soltar geral.

## Sequência de validação recomendada (pós-implementação)

1. Atualizar e reinstalar o plugin WP v2.2.0.
2. `embed:scan:prod` — revisar o CSV de pré-visualização.
3. `embed:migrate:prod -- --dry-run` — conferir o que seria feito.
4. `NODE_ENV=prod node src/embed-cli.js migrate --limit=1` — primeira matéria real.
5. Conferir a matéria no site; se OK, soltar o restante.
