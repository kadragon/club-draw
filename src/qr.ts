import { encode } from "uqr";

/**
 * Draw a QR code for `text` onto `canvas`, bundled (no CDN, no network, no CSP change).
 *
 * Pixels are painted as whole device pixels per module so phone cameras see crisp
 * edges; `border` is the 4-module quiet zone the spec requires for reliable scans.
 */
export function drawQr(canvas: HTMLCanvasElement, text: string, cssSize = 220): void {
  const { data, size } = encode(text, { ecc: "M", border: 4 });
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.max(1, Math.floor((cssSize * dpr) / size));
  canvas.width = canvas.height = size * scale;
  canvas.style.width = canvas.style.height = `${(size * scale) / dpr}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  for (let y = 0; y < size; y++) {
    const row = data[y]!;
    for (let x = 0; x < size; x++) {
      if (row[x]) ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}
