import { contextBridge, ipcRenderer } from 'electron'
import type { RpcMethod, Snapshot, UiEvent } from '../shared/types'

type RpcHandler = () => Promise<unknown>
const handlers = new Map<RpcMethod, RpcHandler>()

ipcRenderer.on('rpc:req', async (_e, msg: { id: string; method: RpcMethod }) => {
  const h = handlers.get(msg.method)
  try {
    if (!h) throw new Error(`no handler for ${msg.method}`)
    ipcRenderer.send('rpc:res', { id: msg.id, ok: true, data: await h() })
  } catch (err) {
    ipcRenderer.send('rpc:res', { id: msg.id, ok: false, error: String(err) })
  }
})

const api = {
  getSnapshot: (): Promise<Snapshot> => ipcRenderer.invoke('booth:get-snapshot'),
  onSnapshot: (cb: (s: Snapshot) => void): (() => void) => {
    const fn = (_e: unknown, s: Snapshot) => cb(s)
    ipcRenderer.on('booth:snapshot', fn)
    return () => ipcRenderer.removeListener('booth:snapshot', fn)
  },
  send: (ev: UiEvent): void => ipcRenderer.send('booth:event', ev),
  handleRpc: (method: RpcMethod, h: RpcHandler): void => {
    handlers.set(method, h)
  }
}

export type BoothApi = typeof api
contextBridge.exposeInMainWorld('booth', api)
