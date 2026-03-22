import http from 'node:http'
import 'dotenv/config'
import { createApp } from './app.js'
import { loadEnv } from './env.js'
import { connectMongo } from './lib/mongo.js'
import { attachAppWebsocket } from './http/ws.js'
import { BinanceIngest, MerkleCheckpointService, RoundEngine } from './services/index.js'
import { logger } from './lib/logger.js'

async function main() {
  const env = loadEnv(process.env)
  await connectMongo(env.MONGODB_URI)

  const app = createApp()
  const server = http.createServer(app)
  attachAppWebsocket(server)

  const ingest = new BinanceIngest(env.BINANCE_WS_BASE)
  const roundEngine = new RoundEngine()
  const merkle = new MerkleCheckpointService()

  await ingest.start()
  await roundEngine.start()
  await merkle.start()

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'Server listening')
  })
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error')
  process.exit(1)
})

