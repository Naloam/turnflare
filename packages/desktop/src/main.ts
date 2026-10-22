import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } from 'electron'
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDesktopRuntime, type DesktopRuntime, type DesktopSource } from './runtime.js'
import { reportRequest, isAppUrl, readSavedFolder } from './policy.js'

app.setName('Turnflare')
if (process.env.TURNFLARE_DESKTOP_USER_DATA) {
  app.setPath('userData', process.env.TURNFLARE_DESKTOP_USER_DATA)
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'turnflare',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

const base = path.dirname(fileURLToPath(import.meta.url))
let window: BrowserWindow | undefined
let runtime: DesktopRuntime | undefined
let switching = false
let quitting = false
let localRoot = path.join(app.getPath('home'), '.claude', 'projects')
const settingsFile = path.join(app.getPath('userData'), 'settings.json')
try {
  localRoot = readSavedFolder(readFileSync(settingsFile, 'utf8')) ?? localRoot
} catch {
  /* First launch. */
}
if (process.env.TURNFLARE_DESKTOP_DATA_ROOT) {
  localRoot = path.resolve(process.env.TURNFLARE_DESKTOP_DATA_ROOT)
}

const csp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
const loading =
  '<!doctype html><html><meta charset="utf-8"><title>Turnflare</title><body style="background:#101214;color:#f2ede7;font:18px system-ui;display:grid;place-items:center;height:95vh"><p>🔥 Turnflare · 正在读取本地记录 / Loading local history…</p></body></html>'

async function switchSource(source: DesktopSource): Promise<void> {
  if (switching) return
  switching = true
  try {
    const next = await openDesktopRuntime(source, {
      indexDirectory: path.join(app.getPath('userData'), 'indexes'),
      webRoot: path.join(base, 'web'),
      version: app.getVersion(),
    })
    const previous = runtime
    runtime = next
    await previous?.close()
    if (source.mode === 'local') {
      localRoot = source.dataRoot
      mkdirSync(path.dirname(settingsFile), { recursive: true })
      writeFileSync(settingsFile, JSON.stringify({ dataRoot: localRoot }), 'utf8')
    }
    await window?.loadURL('turnflare://app/')
  } finally {
    switching = false
  }
}

function assertSender(event: IpcMainInvokeEvent): void {
  if (
    event.sender !== window?.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    !isAppUrl(event.senderFrame.url)
  ) {
    throw new Error('Untrusted desktop request')
  }
}

async function chooseFolder(): Promise<void> {
  if (!window) return
  const selected = await dialog.showOpenDialog(window, {
    title: '选择 Claude Code 日志目录 / Choose Claude Code history',
    properties: ['openDirectory'],
    defaultPath: localRoot,
  })
  const folder = selected.filePaths[0]
  if (!selected.canceled && folder) await switchSource({ mode: 'local', dataRoot: folder })
}

function menuAction(action: () => Promise<void>): () => void {
  return () => {
    void action().catch(() =>
      dialog.showErrorBox(
        'Turnflare',
        '无法打开该目录，请检查权限后重试。 / Unable to open this folder. Check access permissions and retry.',
      ),
    )
  }
}

async function launch(): Promise<void> {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAppUrl(details.url) && !details.url.startsWith('devtools:') })
  })
  ses.protocol.handle('turnflare', async (request) => {
    if (!isAppUrl(request.url)) return new Response('Forbidden', { status: 403 })
    const url = new URL(request.url)
    if (!runtime) {
      return new Response(loading, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp },
      })
    }
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }
    try {
      const result = await runtime.request({
        method: request.method,
        url: url.pathname + url.search,
        ...(request.method === 'POST' ? { payload: await request.text() } : {}),
      })
      return new Response(new Uint8Array(result.body), {
        status: result.status,
        headers: { ...result.headers, 'content-security-policy': csp, 'cache-control': 'no-store' },
      })
    } catch {
      return new Response(
        '{"success":false,"data":null,"error":"Local data is temporarily unavailable"}',
        {
          status: 503,
          headers: { 'content-type': 'application/json' },
        },
      )
    }
  })
  ipcMain.handle('desktop:save-report', async (event, format: unknown, filters: unknown) => {
    assertSender(event)
    const request = reportRequest(format, filters)
    if (!request || !runtime || !window) throw new Error('Invalid report request')
    // Fetch before the dialog: source/filter changes while it is open cannot change this report.
    const result = await runtime.request({ method: 'GET', url: request.url })
    if (result.status !== 200) throw new Error('Unable to generate report')
    const selected = await dialog.showSaveDialog(window, {
      title: 'Save Turnflare report',
      defaultPath: path.join(app.getPath('documents'), `turnflare-report.${request.extension}`),
      filters: [{ name: 'Turnflare report', extensions: [request.extension] }],
    })
    if (selected.canceled || !selected.filePath) return false
    writeFileSync(selected.filePath, result.body)
    return true
  })
  ipcMain.handle('desktop:state', (event) => {
    assertSender(event)
    return runtime?.state
  })
  ipcMain.handle('desktop:choose-folder', async (event) => {
    assertSender(event)
    await chooseFolder()
  })
  ipcMain.handle('desktop:demo', async (event) => {
    assertSender(event)
    await switchSource({ mode: 'demo' })
  })
  ipcMain.handle('desktop:local', async (event) => {
    assertSender(event)
    await switchSource({ mode: 'local', dataRoot: localRoot })
  })

  window = new BrowserWindow({
    title: 'Turnflare',
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#101214',
    show: false,
    icon: path.join(base, 'icon.png'),
    webPreferences: {
      preload: path.join(base, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })
  window.once('ready-to-show', () => window?.show())
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: '数据 / Data',
      submenu: [
        { label: '选择日志目录 / Choose history folder…', click: menuAction(chooseFolder) },
        {
          label: '本地记录 / Local history',
          click: menuAction(() => switchSource({ mode: 'local', dataRoot: localRoot })),
        },
        {
          label: '示例数据 / Example sessions',
          click: menuAction(() => switchSource({ mode: 'demo' })),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      label: '帮助 / Help',
      submenu: [
        {
          label: 'GitHub',
          click: () => {
            void shell.openExternal('https://github.com/Naloam/turnflare')
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  await window.loadURL('turnflare://app/')
  await switchSource({ mode: 'local', dataRoot: localRoot })
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    window?.restore()
    window?.focus()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void runtime
      ?.close()
      .catch((error: unknown) => console.error(error))
      .finally(() => app.quit())
    if (!runtime) app.quit()
  })
  void app
    .whenReady()
    .then(launch)
    .catch((error: unknown) => {
      console.error(error)
      dialog.showErrorBox(
        'Turnflare',
        '启动失败，请重新打开应用或通过 GitHub 反馈。 / Unable to start. Reopen the app or report this on GitHub.',
      )
      app.quit()
    })
}
