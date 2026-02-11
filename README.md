# Vimeo → YouTube Migrator (Oracle) + WordPress Update (ACF)

Script em Node.js que:
1) Busca posts candidatos no WordPress via endpoint custom (`migrate/v1/vimeo-candidates`)
2) Baixa o MP4 do Vimeo via API
3) Faz upload no YouTube (resumable)
4) Atualiza o campo no WordPress (ACF/meta) com a URL no formato `https://youtu.be/<id>`
5) Controla fila/estado com SQLite (retomável)
6) Mede velocidade (download e upload) e mostra progresso
7) Remove o arquivo local após sucesso (cleanup)

---

## Requisitos

- Node.js 18+ (recomendado 20+)
- Acesso Vimeo API token com permissão de ler vídeo e obter link MP4
- Google OAuth 2.0 Client (YouTube Data API v3 habilitada) + Refresh Token
- WordPress com:
  - Application Password habilitado para um usuário com permissão de editar
  - MU-plugin com endpoint `/wp-json/migrate/v1/vimeo-candidates`
  - Campo ACF:
    - Vimeo: `url_do_video_full`
    - YouTube: `url_do_youtube`

> **Importante:** o update via `/wp/v2/{postType}/{id}` com `meta` requer que o meta `url_do_youtube` esteja exposto com `show_in_rest`.  
> Alternativa: criar um endpoint custom de update também.

---

## Instalação

```bash
npm i