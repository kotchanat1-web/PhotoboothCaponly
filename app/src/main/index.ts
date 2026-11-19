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
import { BoothMachine } from './machine'
import { RendererRpc } from './rpc'
import { FileSessionStore } from './session'

protocol.registerSchemesAsPrivileged([{ scheme: 'booth', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const configDir = app.isPackaged ? join(process.resourcesPath, 'config') : join(app.getAppPath(), 'config')
// local.json holds per-machine overrides and (from M2) secrets — never committed (see .gitignore)
const localConfigPath = app.isPackaged ? join(app.getPath('userData'), 'local.json') : join(configDir, 'local.json')
const config = loadConfig(join(configDir, 'default.json'), localConfigPath)

const dataDir = app.getPath('userData')
const sessionsDir = resolve(config.paths.sessionsDir || join(dataDir, 'sessions'))
const logger = new FileLogger(config.paths.logsDir || join(dataDir, 'logs'))
logger.prune(config.logRetentionDays)

const rpc = new RendererRpc(ipcMain)
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/
const SAFE_FILE = /^[A-Za-z0-9_-]+\.jpg$/

function createMachine(): BoothMachine {
  const camera = new FrameCamera(
    config.camera.driver,
    async () => Buffer.from(await rpc.call<ArrayBuffer>('camera:grab')),
    () => rpc.call<CameraStatus>('camera:probe')
  )
  return new BoothMachine({
    config,
    camera,
    printer: new MockPrinter(join(dataDir, 'mock-printer')),
    payment: new MockPaymentProvider({ autoPaySec: config.payment.mock.autoPaySec }),
    relay: config.relay.driver === 'none' ? new NoRelay() : new MockRelay(logger),
    store: new FileSessionStore(sessionsDir),
    logger,
    captureUrl: (sessionId, file) => `booth://capture/${sessionId}/${file}`
  })
}

async function main(): Promise<void> {
  await app.whenReady()
  logger.log('info', 'app.start', { version: app.getVersion(), mode: config.mode, camera: config.camera.driver })

  // booth://capture/<sessionId>/<NN.jpg> → file in the sessions folder (only that folder)
  protocol.handle('booth', (req) => {
    const u = new URL(req.url)
    const [sessionId, file] = u.pathname.split('/').filter(Boolean)
    if (u.host !== 'capture' || !sessionId || !file || !SAFE_SEGMENT.test(sessionId) || !SAFE_FILE.test(file)) {
      return new Response('not found', { status: 404 })
    }
    const p = resolve(sessionsDir, sessionId, 'captures', file)
    if (!p.startsWith(sessionsDir + sep)) return new Response('not found', { status: 404 })
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
