/**
 * Utilitários para medição de velocidade e tempo estimado
 */

/**
 * Cria um medidor de velocidade de transferência
 * @returns {Object} Medidor com métodos tick, snapshot e format
 * @property {Function} tick - Incrementa bytes transferidos
 * @property {Function} snapshot - Retorna estatísticas atuais
 * @property {Function} format - Formata para exibição legível
 */
export function makeSpeedMeter() {
  const start = Date.now();
  let bytes = 0;

  /**
   * Registra bytes transferidos
   * @param {number} n - Quantidade de bytes
   */
  function tick(n) {
    bytes += n;
  }

  /**
   * Retorna snapshot das estatísticas
   * @returns {Object} Estatísticas
   * @property {number} bytes - Total de bytes
   * @property {number} sec - Segundos decorridos
   * @property {number} bps - Bytes por segundo
   * @property {number} mbps - Megabytes por segundo
   */
  function snapshot() {
    const sec = (Date.now() - start) / 1000;
    const bps = sec > 0 ? bytes / sec : 0;
    return { bytes, sec, bps, mbps: bps / (1024 * 1024) };
  }

  /**
   * Formata estatísticas para exibição
   * @returns {string} Formato legível (ex: "100.50 MB @ 5.20 MB/s")
   */
  function format() {
    const s = snapshot();
    return `${(s.bytes / (1024 * 1024)).toFixed(2)} MB @ ${s.mbps.toFixed(2)} MB/s`;
  }

  return { tick, snapshot, format };
}

/**
 * Formata segundos restantes em formato legível
 * @param {number} secondsLeft - Segundos restantes
 * @returns {string} Formato "XmYs" ou "??" se inválido
 * @example
 * eta(125) // "2m5s"
 * eta(Infinity) // "??"
 */
export function eta(secondsLeft) {
  if (!isFinite(secondsLeft) || secondsLeft < 0) return "??";
  const m = Math.floor(secondsLeft / 60);
  const s = Math.floor(secondsLeft % 60);
  return `${m}m${s}s`;
}

/**
 * Formata bytes para unidades legíveis
 * @param {number} bytes - Quantidade de bytes
 * @param {number} [decimals=2] - Casas decimais
 * @returns {string} Formato legível (ex: "1.50 GB")
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

/**
 * Calcula porcentagem de progresso
 * @param {number} current - Valor atual
 * @param {number} total - Valor total
 * @param {number} [decimals=1] - Casas decimais
 * @returns {string} Porcentagem formatada (ex: "45.5%")
 */
export function formatProgress(current, total, decimals = 1) {
  if (total === 0) return "0%";
  const pct = (current / total) * 100;
  return `${pct.toFixed(decimals)}%`;
}
