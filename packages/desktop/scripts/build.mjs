import { build } from 'esbuild'
import { cpSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const directory = path.join(root, 'packages/desktop/dist')
mkdirSync(directory, { recursive: true })
await build({
  entryPoints: [path.join(root, 'packages/desktop/src/main.ts')],
  outfile: path.join(directory, 'main.mjs'),
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  alias: {
    '@turnflare/api': path.join(root, 'packages/api/src/index.ts'),
    '@turnflare/core': path.join(root, 'packages/core/src/index.ts'),
  },
})
await build({
  entryPoints: [path.join(root, 'packages/desktop/src/preload.ts')],
  outfile: path.join(directory, 'preload.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  target: 'node22',
})
cpSync(path.join(root, 'packages/api/src/db/migrations'), path.join(directory, 'migrations'), {
  recursive: true,
})
