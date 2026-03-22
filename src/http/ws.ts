import type http from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
import { eventBus, type AppEvent } from '../events.js'
import { logger } from '../lib/logger.js'

type Client = {
  ws: WebSocket
  subscriptions: Set<string> // tokenPairId strings, or '*' for all
}

export function attachAppWebsocket(server: http.Server) {
  const wss = new WebSocketServer({ server, path: '/ws' })
  const clients = new Set<Client>()

  function send(ws: WebSocket, msg: unknown) {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(msg))
  }

  wss.on('connection', (ws) => {
    const client: Client = { ws, subscriptions: new Set(['*']) }
    clients.add(client)
    send(ws, { type: 'ws.welcome', subscriptions: Array.from(client.subscriptions) })

    ws.on('message', (buf) => {
      try {
        const msg = JSON.parse(buf.toString()) as { type: string; tokenPairId?: string }
        if (msg.type === 'subscribe' && msg.tokenPairId) {
          client.subscriptions.add(msg.tokenPairId)
          client.subscriptions.delete('*')
          send(ws, { type: 'ws.subscribed', tokenPairId: msg.tokenPairId })
        } else if (msg.type === 'subscribeAll') {
          client.subscriptions.clear()
          client.subscriptions.add('*')
          send(ws, { type: 'ws.subscribedAll' })
        }
      } catch {
        // ignore
      }
    })

    ws.on('close', () => {
      clients.delete(client)
    })
  })

  const handler = (evt: AppEvent) => {
    for (const c of clients) {
      if (c.subscriptions.has('*') || c.subscriptions.has(evt.tokenPairId)) {
        send(c.ws, evt)
      }
    }
  }

  eventBus.on('event', handler)

  wss.on('close', () => {
    eventBus.off('event', handler)
  })

  logger.info({ path: '/ws' }, 'App websocket attached')
}

