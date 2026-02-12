<?php
/**
 * Plugin Name: Vimeo2YT Migrate Endpoints (Token Auth) - UPDATED
 * Description: Endpoints para listar candidatos (play) com Vimeo e atualizar ACF url_do_youtube usando X-MIGRATE-TOKEN.
 * Version: 2.1.0
 */

if (!defined('ABSPATH')) exit;

/**
 * Coloque o token no wp-config.php:
 * define('MIGRATE_TOKEN', 'UM_TOKEN_BEM_GRANDE_AQUI');
 */
function vimeo2yt_expected_token() {
  if (defined('MIGRATE_TOKEN') && MIGRATE_TOKEN) return (string) MIGRATE_TOKEN;
  $env = getenv('MIGRATE_TOKEN');
  return $env ? (string) $env : '';
}

function vimeo2yt_token_ok(WP_REST_Request $req) {
  $token = (string) $req->get_header('x-migrate-token');
  $expected = vimeo2yt_expected_token();
  return $expected && hash_equals($expected, $token);
}

add_action('rest_api_init', function () {

  // 1) LISTAR CANDIDATOS
  register_rest_route('migrate/v1', '/vimeo-candidates', [
    'methods'  => 'GET',
    'callback' => 'vimeo2yt_get_candidates',
    'permission_callback' => 'vimeo2yt_token_ok',
    'args' => [
      'per_page' => [
        'type' => 'integer',
        'default' => 20,
      ],
      'page' => [
        'type' => 'integer',
        'default' => 1,
      ],
      'force' => [
        'type' => 'boolean',
        'default' => false,
        'description' => 'Se true, inclui posts mesmo que já tenham url_do_youtube preenchido.'
      ],
    ],
  ]);

  // 2) ATUALIZAR YOUTUBE
  register_rest_route('migrate/v1', '/update-youtube', [
    'methods'  => 'POST',
    'callback' => 'vimeo2yt_update_youtube',
    'permission_callback' => 'vimeo2yt_token_ok',
    'args' => [
      'post_id' => ['type' => 'integer', 'required' => true],
      'youtube_url' => ['type' => 'string', 'required' => true],
    ],
  ]);

});

/**
 * Limpa o conteúdo HTML para uso no YouTube
 * Remove iframes, scripts, divs vazios, mantém texto limpo
 * Normaliza quebras de linha para \n
 */
function vimeo2yt_clean_content($content) {
  if (empty($content)) return '';
  
  // Normaliza quebras de linha Windows (\r\n) e Mac antigo (\r) para Unix (\n)
  $content = str_replace(["\r\n", "\r"], "\n", $content);
  
  // Remove scripts e iframes
  $content = preg_replace('/<script[^>]*>.*?<\/script>/is', '', $content);
  $content = preg_replace('/<iframe[^>]*>.*?<\/iframe>/is', '', $content);
  
  // Remove divs vazios ou com apenas estilos
  $content = preg_replace('/<div[^>]*>(\s|&nbsp;)*<\/div>/is', '', $content);
  
  // Converte quebras de linha HTML para \n
  $content = preg_replace('/<br\s*\/?>/i', "\n", $content);
  $content = preg_replace('/<\/p>/i', "\n\n", $content);
  
  // Remove todas as tags HTML restantes
  $content = wp_strip_all_tags($content);
  
  // Decodifica HTML entities (&amp; → &, " → ", etc.)
  $content = html_entity_decode($content, ENT_QUOTES | ENT_HTML5, 'UTF-8');
  
  // Converte aspas curly para aspas retas
  $search = array('"', '"', "'", "'", '–', '—');
  $replace = array('"', '"', "'", "'", '-', '-');
  $content = str_replace($search, $replace, $content);
  
  // Limpa múltiplos espaços consecutivos (mas mantém quebras de linha)
  $content = preg_replace('/[ \t]+/', ' ', $content);
  
  // Limpa espaços e quebras de linha excessivas
  $content = preg_replace('/\n{3,}/', "\n\n", $content);
  $content = trim($content);
  
  return $content;
}

/**
 * GET /wp-json/migrate/v1/vimeo-candidates?per_page=20&page=1&force=false
 *
 * Retorna:
 * {
 *   page, per_page, total, total_pages,
 *   items: [{
 *     id, 
 *     vimeo_url,
 *     title,           // post_title
 *     content,         // post_content limpo (sem HTML)
 *     tags,            // array de nomes das tags
 *     slug,            // post_name (slug)
 *     post_url         // URL completa da matéria
 *   }]
 * }
 *
 * post_type = play
 * Vimeo em ACF: url_do_video_full
 * YouTube em ACF: url_do_youtube
 */
function vimeo2yt_get_candidates(WP_REST_Request $req) {
  $per_page = max(1, min(100, (int) $req->get_param('per_page')));
  $page     = max(1, (int) $req->get_param('page'));
  $force    = (bool) $req->get_param('force');

  $post_type   = 'play';
  $acf_vimeo   = 'url_do_video_full';
  $acf_youtube = 'url_do_youtube';

  $meta_query = [
    'relation' => 'AND',
    // precisa ter vimeo preenchido
    [
      'key' => $acf_vimeo,
      'compare' => 'EXISTS',
    ],
    [
      'key' => $acf_vimeo,
      'value' => '',
      'compare' => '!=',
    ],
  ];

  if (!$force) {
    // só pega os que ainda não têm youtube preenchido
    $meta_query[] = [
      'relation' => 'OR',
      [
        'key' => $acf_youtube,
        'compare' => 'NOT EXISTS',
      ],
      [
        'key' => $acf_youtube,
        'value' => '',
        'compare' => '=',
      ],
    ];
  }

  $q = new WP_Query([
    'post_type'      => $post_type,
    'post_status'    => 'any',
    'posts_per_page' => $per_page,
    'paged'          => $page,
    'meta_query'     => $meta_query,
    'orderby'        => 'date',
    'order'          => 'DESC',
    'no_found_rows'  => false,
  ]);

  $items = [];
  foreach ($q->posts as $post) {
    $post_id = $post->ID;
    $vimeo_url = get_field($acf_vimeo, $post_id);
    if (!$vimeo_url) continue;

    if (!$force) {
      $yt_url = get_field($acf_youtube, $post_id);
      if (!empty($yt_url)) continue;
    }

    // Busca tags do post
    $tags = [];
    $post_tags = get_the_tags($post_id);
    if ($post_tags && !is_wp_error($post_tags)) {
      $tags = array_map(function($tag) {
        return $tag->name;
      }, $post_tags);
    }

    // Se não tiver tags no post_tag, tenta outras taxonomias
    if (empty($tags)) {
      $taxonomies = get_object_taxonomies($post_type);
      foreach ($taxonomies as $tax) {
        if ($tax === 'post_tag') continue; // já tentou acima
        $terms = get_the_terms($post_id, $tax);
        if ($terms && !is_wp_error($terms)) {
          foreach ($terms as $term) {
            $tags[] = $term->name;
          }
        }
      }
    }

    // Busca conteúdo do campo ACF/meta: conteudo_play
    $raw_content = get_post_meta($post_id, 'conteudo_play', true);
    
    // Se não encontrou, tenta post_excerpt como fallback
    if (empty($raw_content)) {
      $raw_content = $post->post_excerpt;
    }
    
    $cleaned_content = vimeo2yt_clean_content($raw_content);
    
    // Constrói URL completa da matéria
    $post_url = get_permalink($post_id);
    
    $items[] = [
      'id'         => (int) $post_id,
      'vimeo_url'  => (string) $vimeo_url,
      'title'      => (string) $post->post_title,
      'content'    => (string) $cleaned_content,
      'tags'       => array_values(array_unique($tags)), // remove duplicatas e reindexa
      'slug'       => (string) $post->post_name,
      'post_url'   => (string) $post_url,
    ];
  }

  return new WP_REST_Response([
    'page'        => $page,
    'per_page'    => $per_page,
    'total'       => (int) $q->found_posts,
    'total_pages' => (int) $q->max_num_pages,
    'items'       => $items,
  ], 200);
}

/**
 * POST /wp-json/migrate/v1/update-youtube
 * Body JSON: { "post_id": 123, "youtube_url": "https://youtu.be/xxxx" }
 */
function vimeo2yt_update_youtube(WP_REST_Request $req) {
  $post_id = (int) $req->get_param('post_id');
  $youtube_url = (string) $req->get_param('youtube_url');

  if (!$post_id || !$youtube_url) {
    return new WP_REST_Response(['ok' => false, 'error' => 'missing_params'], 400);
  }

  // Atualiza ACF diretamente
  update_field('url_do_youtube', $youtube_url, $post_id);

  return new WP_REST_Response([
    'ok' => true,
    'post_id' => $post_id,
    'youtube_url' => $youtube_url
  ], 200);
}
