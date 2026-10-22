/** Stage an ordinary npm application, isolated from pnpm and the Node CLI's native modules. */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'electron-builder'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = path.join(root, 'release/desktop-app')
const json = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'))
const dependencies = {}
for (const name of Object.keys(json('packages/api/package.json').dependencies)) {
  if (!name.startsWith('@turnflare/'))
    dependencies[name] = json(`packages/api/node_modules/${name}/package.json`).version
}
rmSync(directory, { recursive: true, force: true })
mkdirSync(directory, { recursive: true })
cpSync(path.join(root, 'packages/desktop/dist'), directory, { recursive: true })
cpSync(path.join(root, 'packages/web/dist'), path.join(directory, 'web'), {
  recursive: true,
  filter: (file) => !file.endsWith('.map'),
})
cpSync(path.join(root, 'packages/desktop/assets/icon.png'), path.join(directory, 'icon.png'))
for (const file of ['LICENSE', 'SECURITY.md'])
  cpSync(path.join(root, file), path.join(directory, file))
writeFileSync(
  path.join(directory, 'package.json'),
  JSON.stringify(
    {
      name: 'turnflare-desktop',
      productName: 'Turnflare',
      version: json('packages/desktop/package.json').version,
      description: 'Local Claude Code session, subagent and token cost explorer',
      author: 'Turnflare contributors',
      license: 'MIT',
      type: 'module',
      main: 'main.mjs',
      repository: 'https://github.com/Naloam/turnflare',
      dependencies,
    },
    null,
    2,
  ) + '\n',
)
const options = { cwd: directory, stdio: 'inherit', timeout: 300000 }
const install =
  process.platform === 'win32'
    ? spawnSync(
        process.env.ComSpec ?? 'cmd.exe',
        ['/d', '/s', '/c', 'npm install --omit=dev --ignore-scripts --no-audit --no-fund'],
        options,
      )
    : spawnSync(
        'npm',
        ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
        options,
      )
if (install.status !== 0) throw new Error('Desktop dependency installation failed')
await build({
  projectDir: root,
  config: path.join(root, 'electron-builder.yml'),
  ...(process.argv.includes('--dir') ? { dir: true } : {}),
})
