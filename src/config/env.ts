import path from "node:path"
import fs from "node:fs"

import dotenv from "dotenv"

const projectRoot = path.resolve(__dirname, "../..")
const envCandidates = [
  path.resolve(projectRoot, ".env"),
  path.resolve(projectRoot, "src/.env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "src/.env"),
  path.resolve(process.cwd(), "tac-backend/.env"),
  path.resolve(process.cwd(), "tac-backend/src/.env"),
]

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false })
  }
}

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

function normalizeUrl(url: string) {
  return url.replace(/\/+$/, "")
}

function normalizeGoogleCallbackUrl(callbackUrl: string, backendUrl: string) {
  const normalizedBackendUrl = normalizeUrl(backendUrl)
  const defaultCallbackUrl = `${normalizedBackendUrl}/api/auth/google/callback`
  const trimmedCallbackUrl = callbackUrl.trim()

  if (!trimmedCallbackUrl) {
    return defaultCallbackUrl
  }

  try {
    const url = new URL(trimmedCallbackUrl, normalizedBackendUrl)

    if (url.pathname === "/auth/google/callback") {
      url.pathname = "/api/auth/google/callback"
    }

    return url.toString()
  } catch {
    return defaultCallbackUrl
  }
}

const port = Number(process.env.PORT ?? 4000)
const frontendUrl = normalizeUrl(process.env.FRONTEND_URL ?? "http://localhost:3000")
const backendUrl = normalizeUrl(
  process.env.BACKEND_URL ?? `http://localhost:${port}`
)

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port,
  frontendUrl,
  backendUrl,
  databaseUrl: getRequiredEnv("DATABASE_URL"),
  googleClientId: getRequiredEnv("GOOGLE_CLIENT_ID"),
  googleClientSecret: getRequiredEnv("GOOGLE_CLIENT_SECRET"),
  googleCallbackUrl: normalizeGoogleCallbackUrl(
    process.env.GOOGLE_CALLBACK_URL ?? "",
    backendUrl
  ),
  sessionSecret: getRequiredEnv("SESSION_SECRET"),
  isProduction: (process.env.NODE_ENV ?? "development") === "production",
}
