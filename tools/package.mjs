#!/usr/bin/env node
/** Build only our workspace code; npm installs the pinned third-party dependencies. */
import { build } from 'esbuild'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = path.join(root, 'release/package')
const runtime = path.join(directory, 'packages/cli/dist')
const json = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'))
const version = json('package.json').version
rmSync(directory, { recursive: true, force: true })
mkdirSync(runtime, { recursive: true })
await build({
  entryPoints: {
    cli: path.join(root, 'packages/cli/src/bin.ts'),
    demo: path.join(root, 'tools/demo-server.mjs'),
    start: path.join(root, 'tools/start-runtime.mjs'),
  },
  outdir: runtime,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  alias: {
    '@turnflare/api': path.join(root, 'packages/api/src/index.ts'),
    '@turnflare/core': path.join(root, 'packages/core/src/index.ts'),
  },
  sourcemap: false,
  legalComments: 'eof',
})
cpSync(path.join(root, 'packages/web/dist'), path.join(directory, 'packages/web/dist'), {
  recursive: true,
  filter: (file) => !file.endsWith('.map'),
})
cpSync(path.join(root, 'packages/api/src/db/migrations'), path.join(runtime, 'migrations'), {
  recursive: true,
})
for (const file of ['README.md', 'README.zh-CN.md', 'LICENSE', 'SECURITY.md'])
  cpSync(path.join(root, file), path.join(directory, file))
const dependencies = {}
for (const pkg of ['api', 'cli']) {
  for (const name of Object.keys(json(`packages/${pkg}/package.json`).dependencies)) {
    if (!name.startsWith('@turnflare/')) {
      dependencies[name] = json(`packages/${pkg}/node_modules/${name}/package.json`).version
    }
  }
}
writeFileSync(
  path.join(runtime, 'turnflare.mjs'),
  `#!/usr/bin/env node
const command = process.argv[2]
if (command === 'demo' || command === 'start') {
  process.argv.splice(2, 1)
  await import(command === 'demo' ? './demo.mjs' : './start.mjs')
} else await import('./cli.mjs')
`,
)
chmodSync(path.join(runtime, 'turnflare.mjs'), 0o755)
writeFileSync(
  path.join(directory, 'package.json'),
  JSON.stringify(
    {
      name: 'turnflare',
      version,
      type: 'module',
      license: 'MIT',
      description: 'Local Claude Code session, subagent and token cost explorer',
      bin: { turnflare: 'packages/cli/dist/turnflare.mjs' },
      engines: { node: '>=22.0.0' },
      dependencies,
      repository: { type: 'git', url: 'https://github.com/Naloam/turnflare.git' },
      homepage: 'https://github.com/Naloam/turnflare#readme',
      bugs: { url: 'https://github.com/Naloam/turnflare/issues' },
      files: ['packages', 'README.md', 'README.zh-CN.md', 'LICENSE', 'SECURITY.md'],
    },
    null,
    2,
  ) + '\n',
)
const packed = spawnSync(
  'npm',
  ['pack', '--json', '--pack-destination', path.join(root, 'release')],
  { cwd: directory, encoding: 'utf8' },
)
if (packed.status !== 0) throw new Error(packed.stderr)
const [artifact] = JSON.parse(packed.stdout)
console.log(
  JSON.stringify({
    file: path.join(root, 'release', artifact.filename),
    directory,
    files: artifact.files.map((file) => file.path),
  }),
)
