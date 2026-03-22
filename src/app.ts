import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import pinoHttp from 'pino-http'
import { createRouter } from './http/router.js'
import { errorHandler, notFound } from './http/errors.js'
import { logger } from './lib/logger.js'

export function createApp() {
  const app = express()
  app.use(helmet())
  app.use(cors({ origin: true }))
  app.use(express.json({ limit: '1mb' }))
  app.use(pinoHttp({ logger }))

  app.use('/api', createRouter())
  app.use(notFound)
  app.use(errorHandler)
  return app
}

