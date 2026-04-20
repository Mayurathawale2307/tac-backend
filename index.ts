import { createServer } from "node:http"

import { env } from "./src/config/env"
import { prisma } from "./src/lib/prisma"
import { app } from "./src/server"

const server = createServer(app)

server.listen(env.port, () => {
  console.log(
    `TAC backend listening on http://localhost:${env.port} in ${env.nodeEnv} mode`
  )
})

async function shutdown(signal: string) {
  console.log(`${signal} received. Shutting down gracefully...`)

  server.close(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
}

process.on("SIGINT", () => {
  void shutdown("SIGINT")
})

process.on("SIGTERM", () => {
  void shutdown("SIGTERM")
})
