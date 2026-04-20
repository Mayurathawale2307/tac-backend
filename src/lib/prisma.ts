import { PrismaClient } from "@prisma/client"

declare global {
  var __tacPrisma__: PrismaClient | undefined
}

const prisma = global.__tacPrisma__ ?? new PrismaClient()

if (process.env.NODE_ENV !== "production") {
  global.__tacPrisma__ = prisma
}

export { prisma }
