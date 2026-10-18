// Downloads the CC0 PBR textures the renderer uses from Poly Haven into public/assets/textures.
// Usage: node tools/assets/fetch-assets.mjs   (Node fetch: curl fails TLS on some machines)
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';

const OUT = path.resolve('public/assets/textures');
const RES = '1k';
/** asset id -> maps to fetch (Poly Haven map names) */
const ASSETS = {
  snow_02: ['Diffuse', 'nor_gl', 'arm'],
  gray_rocks: ['Diffuse', 'nor_gl'],
  asphalt_snow: ['Diffuse', 'nor_gl'],
  japanese_cedar_planks: ['Diffuse', 'nor_gl', 'arm'],
  brushed_concrete: ['Diffuse', 'nor_gl', 'arm'],
  corrugated_iron_02: ['Diffuse', 'nor_gl', 'arm'],
  japanese_cedar_bark: ['Diffuse', 'nor_gl'],
};
const SHORT = { Diffuse: 'diff', nor_gl: 'nor', arm: 'arm' };

const credits = [];
for (const [id, maps] of Object.entries(ASSETS)) {
  const [files, info] = await Promise.all([
    fetch(`https://api.polyhaven.com/files/${id}`).then((r) => r.json()),
    fetch(`https://api.polyhaven.com/info/${id}`).then((r) => r.json()),
  ]);
  fs.mkdirSync(path.join(OUT, id), { recursive: true });
  for (const map of maps) {
    const url = files[map][RES].jpg.url;
    const dest = path.join(OUT, id, `${SHORT[map]}.jpg`);
    if (!fs.existsSync(dest)) {
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      // Poly Haven ships near-lossless JPEGs; q80 is indistinguishable on terrain and ~3x smaller
      const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 });
      fs.writeFileSync(dest, jpeg.encode(img, 80).data);
    }
    console.log(`${id}/${SHORT[map]}.jpg`);
  }
  credits.push(`| ${id} | ${info.name} | ${Object.keys(info.authors).join(', ')} | https://polyhaven.com/a/${id} |`);
}
fs.writeFileSync(
  path.resolve('public/assets/LICENSES.md'),
  `# Third-party assets\n\nAll textures below are from [Poly Haven](https://polyhaven.com) and released under\n[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain). Downloaded at ${RES} by\n\`tools/assets/fetch-assets.mjs\`.\n\n| Folder | Name | Author | Source |\n|---|---|---|---|\n${credits.join('\n')}\n`,
);
