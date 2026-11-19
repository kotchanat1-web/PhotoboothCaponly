import { randomUUID } from 'node:crypto'
import type { IpcMain, WebContents } from 'electron'
import type { RpcMethod } from '../shared/types'

/** Main → renderer request/response (used to grab live-view frames from the UI). */
export class RendererRpc {
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private target: WebContents | null = null

  constructor(ipcMain: IpcMain) {
    ipcMain.on('rpc:res', (_e, msg: { id: string; ok: boolean; data?: unknown; error?: string }) => {
      const p = this.pending.get(msg.id)
      if (!p) return
      clearTimeout(p.timer)
      this.pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.data)
      else p.reject(new Error(msg.error ?? 'renderer error'))
    })
  }

  attach(wc: WebContents): void {
    this.target = wc
  }

  call<T>(method: RpcMethod, timeoutMs = 5000): Promise<T> {
    const wc = this.target
    if (!wc || wc.isDestroyed()) return Promise.reject(new Error('UI not available'))
    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      wc.send('rpc:req', { id, method })
    })
  }
}
