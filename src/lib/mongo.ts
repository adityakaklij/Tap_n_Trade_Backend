import mongoose from 'mongoose'
import { logger } from './logger.js'

let connected = false

export async function connectMongo(uri: string) {
  if (connected) return
  mongoose.set('strictQuery', true)
  await mongoose.connect(uri, {
    autoIndex: true
  })
  connected = true
  logger.info({ mongo: mongoose.connection.name }, 'Mongo connected')
}

