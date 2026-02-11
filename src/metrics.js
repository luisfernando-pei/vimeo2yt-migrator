export function makeSpeedMeter() {
  const start = Date.now();
  let bytes = 0;

  function tick(n) {
    bytes += n;
  }

  function snapshot() {
    const sec = (Date.now() - start) / 1000;
    const bps = sec > 0 ? bytes / sec : 0;
    return { bytes, sec, bps, mbps: bps / (1024 * 1024) };
  }

  function format() {
    const s = snapshot();
    return `${(s.bytes / (1024 * 1024)).toFixed(2)} MB @ ${s.mbps.toFixed(2)} MB/s`;
  }

  return { tick, snapshot, format };
}

export function eta(secondsLeft) {
  if (!isFinite(secondsLeft) || secondsLeft < 0) return "??";
  const m = Math.floor(secondsLeft / 60);
  const s = Math.floor(secondsLeft % 60);
  return `${m}m${s}s`;
}