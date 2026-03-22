import { z } from 'zod'

export const WalletAddressSchema = z.string().min(10).max(80)

export const MistAmountSchema = z
  .string()
  .regex(/^\d+$/, 'Amount must be an integer string (MIST)')

export const ObjectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId')

