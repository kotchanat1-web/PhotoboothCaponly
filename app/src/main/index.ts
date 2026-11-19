import { app, BrowserWindow, ipcMain, net, protocol, session, systemPreferences } from 'electron'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Snapshot, UiEvent } from '../shared/types'
import { loadConfig } from './config'
import type { CameraStatus } from './drivers/camera'
import { FrameCamera } from './drivers/camera/frameCamera'
import { MockPaymentProvider } from './drivers/payment'
import { MockPrinter } from './drivers/printer'
import { MockRelay, NoRelay } from './drivers/relay'
import { FileLogger } from './logger'
import { composeToFile } from './compose'
import { BoothMachine } from './machine'
import { RendererRpc } from './rpc'
import { FileSessionStore } from './session'
import { loadTemplates } from './templates'

protocol.registerSchemesAsPrivileged([{ scheme: 'booth', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const configDir = app.isPackaged ? join(process.resourcesPath, 'config') : join(app.getAppPath(), 'config')
// local.json holds per-machine overrides and (from M2) secrets — never committed (see .gitignore)
const localConfigPath = app.isPackaged ? join(app.getPath('userData'), 'local.json') : join(configDir, 'local.json')
const config = loadConfig(join(configDir, 'default.json'), localConfigPath)

const dataDir = app.getPath('userData')
const sessionsDir = resolve(config.paths.sessionsDir || join(dataDir, 'sessions'))
const logger = new FileLogger(config.paths.logsDir || join(dataDir, 'logs'))
logger.prune(config.logRetentionDays)

// dev: the repo's Templates/ folder; on the booth set paths.templatesDir in local.json
const templatesDir = resolve(config.paths.templatesDir || join(app.getAppPath(), '..', 'Templates'))
const loaded = loadTemplates(templatesDir)
for (const e of loaded.errors) logger.log('error', 'template.invalid', e)
logger.log('info', 'templates.loaded', { dir: templatesDir, count: loaded.templates.length, visible: loaded.templates.filter((t) => t.visible).length })
const templatesById = new Map(loaded.templates.map((t) => [t.id, t]))

const rpc = new RendererRpc(ipcMain)
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/
const SAFE_FILE = /^[A-Za-z0-9_-]+\.jpg$/

function createMachine(): BoothMachine {
  const camera = new FrameCamera(
    config.camera.driver,
    async () => Buffer.from(await rpc.call<ArrayBuffer>('camera:grab')),
    () => rpc.call<CameraStatus>('camera:probe', 15_000) // first open of a webcam (e.g. EOS Webcam Utility) can be slow
  )
  return new BoothMachine({
    config,
    camera,
    printer: new MockPrinter(join(dataDir, 'mock-printer')),
    payment: new MockPaymentProvider({ autoPaySec: config.payment.mock.autoPaySec }),
    relay: config.relay.driver === 'none' ? new NoRelay() : new MockRelay(logger),
    store: new FileSessionStore(sessionsDir),
    logger,
    templates: loaded.templates,
    compose: composeToFile,
    urls: {
      capture: (sessionId, file) => `booth://capture/${sessionId}/${file}`,
      print: (sessionId, file) => `booth://print/${sessionId}/${file}`,
      preview: (id) => `booth://template/${encodeURIComponent(id)}/preview.png`
    }
  })
}

async function main(): Promise<void> {
  await app.whenReady()
  logger.log('info', 'app.start', { version: app.getVersion(), mode: config.mode, camera: config.camera.driver })

  // booth://capture/<sessionId>/<NN.jpg>        → <sessions>/<sessionId>/captures/NN.jpg
  // booth://print/<sessionId>/<file.jpg>         → <sessions>/<sessionId>/<file.jpg>
  // booth://template/<templateId>/preview.png    → preview of a LOADED template (looked up, never a raw path)
  protocol.handle('booth', (req) => {
    const u = new URL(req.url)
    const notFound = () => new Response('not found', { status: 404 })
    const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    if (u.host === 'template') {
      const t = templatesById.get(parts[0] ?? '')
      return t?.previewPath && parts[1] === 'preview.png' ? net.fetch(pathToFileURL(t.previewPath).toString()) : notFound()
    }
    const [sessionId, file] = parts
    if (!sessionId || !file || !SAFE_SEGMENT.test(sessionId) || !SAFE_FILE.test(file)) return notFound()
    let p: string
    if (u.host === 'capture') p = resolve(sessionsDir, sessionId, 'captures', file)
    else if (u.host === 'print') p = resolve(sessionsDir, sessionId, file)
    else return notFound()
    if (!p.startsWith(sessionsDir + sep)) return notFound()
    return net.fetch(pathToFileURL(p).toString())
  })

  if (config.camera.driver === 'webcam' && process.platform === 'darwin') {
    await systemPreferences.askForMediaAccess('camera')
  }
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'))

  const win = new BrowserWindow({
    width: config.window.width,
    height: config.window.height,
    fullscreen: config.window.fullscreen,
    kiosk: config.window.kiosk, // UI-1
    backgroundColor: '#111111',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.webContents.on('context-menu', (e) => e.preventDefault()) // UI-1: no right-click
  rpc.attach(win.webContents)

  const machine = createMachine()
  const push = (s: Snapshot) => {
    if (!win.isDestroyed()) win.webContents.send('booth:snapshot', s)
  }
  machine.subscribe(push)
  ipcMain.handle('booth:get-snapshot', () => machine.snapshot)
  ipcMain.on('booth:event', (_e, ev: UiEvent) => machine.dispatch(ev))

  if (process.env['ELECTRON_RENDERER_URL']) await win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else await win.loadFile(join(__dirname, '../renderer/index.html'))

  await machine.start()
}

app.on('window-all-closed', () => app.quit())
process.on('uncaughtException', (e) => logger.log('error', 'uncaught', { error: String(e), stack: e.stack }))
process.on('unhandledRejection', (e) => logger.log('error', 'unhandled_rejection', { error: String(e) }))

main().catch((e) => {
  logger.log('error', 'app.start_failed', { error: String(e) })
  app.exit(1)
})
