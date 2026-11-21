import { DurableObject } from 'cloudflare:workers'

/**
 * One Durable Object per booth: holds the booth's WebSocket(s) and pushes charge updates (PAY-2: webhook → push).
 * The message only says "charge X changed" — the booth then asks GET /v1/charges/X, so a push alone never pays.
 * Uses the hibernation API, so an idle booth connection costs nothing.
 */
export class BoothHub extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  /** RPC from the Worker: tell connected booth sockets that a charge changed. */
  async notify(msg: { type: 'charge'; chargeId: string; status: string }): Promise<number> {
    const sockets = this.ctx.getWebSockets()
    for (const ws of sockets) {
      try {
        ws.send(JSON.stringify(msg))
      } catch {
        // socket already closing — the booth's poll fallback covers it
      }
    }
    return sockets.length
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') ws.send('pong')
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason)
    } catch {
      // already closed
    }
  }
}
