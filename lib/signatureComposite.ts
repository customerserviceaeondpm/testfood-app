import { PNG } from 'pngjs';

const TARGET_H = 300;
const GAP = 20;

async function fetchPng(url: string): Promise<PNG | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return PNG.sync.read(buf);
  } catch {
    return null;
  }
}

function scaleToHeight(src: PNG, targetH: number): PNG {
  const ratio = targetH / src.height;
  const targetW = Math.max(1, Math.round(src.width * ratio));
  const out = new PNG({ width: targetW, height: targetH });
  for (let y = 0; y < targetH; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y / ratio));
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / ratio));
      const si = (src.width * sy + sx) * 4;
      const di = (targetW * y + x) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}

export async function compositeSignaturesHorizontal(urls: (string | null)[]): Promise<Buffer | null> {
  const valid = urls.filter((u): u is string => !!u);
  if (valid.length === 0) return null;
  if (valid.length === 1) {
    try {
      const res = await fetch(valid[0]);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  const images: PNG[] = [];
  for (const url of valid) {
    const img = await fetchPng(url);
    if (img) images.push(scaleToHeight(img, TARGET_H));
  }
  if (images.length === 0) return null;
  if (images.length === 1) {
    return PNG.sync.write(images[0]);
  }

  const totalW = images.reduce((s, im) => s + im.width, 0) + GAP * (images.length - 1);
  const out = new PNG({ width: totalW, height: TARGET_H });
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 255;
    out.data[i + 1] = 255;
    out.data[i + 2] = 255;
    out.data[i + 3] = 255;
  }

  let dx = 0;
  for (const im of images) {
    for (let y = 0; y < TARGET_H; y++) {
      for (let x = 0; x < im.width; x++) {
        const si = (im.width * y + x) * 4;
        const di = (totalW * y + (dx + x)) * 4;
        const alpha = im.data[si + 3] / 255;
        out.data[di] = Math.round(im.data[si] * alpha + out.data[di] * (1 - alpha));
        out.data[di + 1] = Math.round(im.data[si + 1] * alpha + out.data[di + 1] * (1 - alpha));
        out.data[di + 2] = Math.round(im.data[si + 2] * alpha + out.data[di + 2] * (1 - alpha));
        out.data[di + 3] = 255;
      }
    }
    dx += im.width + GAP;
  }

  return PNG.sync.write(out);
}
