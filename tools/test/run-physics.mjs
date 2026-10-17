// Bundle the physics test with esbuild (bundled with Vite) and run it in Node.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const out = path.join(os.tmpdir(), 'ski-physics-test.mjs');
await build({
  entryPoints: ['tools/test/physics.test.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  logLevel: 'warning',
});
execFileSync(process.execPath, [out], { stdio: 'inherit' });
