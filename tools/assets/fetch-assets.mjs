// Downloads the CC0 PBR textures and glTF props the renderer uses from Poly Haven into public/assets.
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
};
const SHORT = { Diffuse: 'diff', nor_gl: 'nor', arm: 'arm' };
/** glTF props, placed around the lodges; their textures are halved to 512 px */
const MODELS = ['painted_wooden_bench', 'outdoor_table_chair_set_01'];

/** decode → optional 2x box downsample → q80 */
function recompress(buf, halve = false) {
  let img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 });
  if (halve) {
    const w = img.width >> 1, h = img.height >> 1, src = img.data, out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 4; c++) {
          const i = (y * 2 * img.width + x * 2) * 4 + c;
          out[(y * w + x) * 4 + c] = (src[i] + src[i + 4] + src[i + img.width * 4] + src[i + img.width * 4 + 4] + 2) >> 2;
        }
      }
    }
    img = { width: w, height: h, data: out };
  }
  return jpeg.encode(img, 80).data;
}

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
      fs.writeFileSync(dest, recompress(buf));
    }
    console.log(`${id}/${SHORT[map]}.jpg`);
  }
  credits.push(`| ${id} | ${info.name} | ${Object.keys(info.authors).join(', ')} | https://polyhaven.com/a/${id} |`);
}
const MODEL_OUT = path.resolve('public/assets/models');
const modelCredits = [];
for (const id of MODELS) {
  const [files, info] = await Promise.all([
    fetch(`https://api.polyhaven.com/files/${id}`).then((r) => r.json()),
    fetch(`https://api.polyhaven.com/info/${id}`).then((r) => r.json()),
  ]);
  const g = files.gltf[RES].gltf;
  const dir = path.join(MODEL_OUT, id);
  fs.mkdirSync(path.join(dir, 'textures'), { recursive: true });
  for (const [rel, f] of [[`${id}.gltf`, g], ...Object.entries(g.include)]) {
    const dest = path.join(dir, rel);
    if (fs.existsSync(dest)) continue;
    const buf = Buffer.from(await (await fetch(f.url)).arrayBuffer());
    fs.writeFileSync(dest, rel.endsWith('.jpg') ? recompress(buf, true) : buf);
  }
  console.log(`models/${id}`);
  modelCredits.push(`| models/${id} | ${info.name} | ${Object.keys(info.authors).join(', ')} | https://polyhaven.com/a/${id} |`);
}

fs.writeFileSync(
  path.resolve('public/assets/LICENSES.md'),
  `# Third-party assets\n\nAll textures and models below are from [Poly Haven](https://polyhaven.com) and released under\n[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain). Downloaded at ${RES} by\n\`tools/assets/fetch-assets.mjs\`.\n\n| Folder | Name | Author | Source |\n|---|---|---|---|\n${[...credits, ...modelCredits].join('\n')}\n`,
);
