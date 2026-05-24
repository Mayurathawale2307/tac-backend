import path from "node:path"
import fs from "node:fs"

import dotenv from "dotenv"

const projectRoot = path.resolve(__dirname, "../..")
const nodeEnv = process.env.NODE_ENV?.trim() || "development"
const isRenderDeployment = process.env.RENDER === "true"
const isVercelDeployment = process.env.VERCEL === "1"
const envFileNames = [
  ".env",
  `.env.${nodeEnv}`,
  ".env.local",
  `.env.${nodeEnv}.local`,
]
const envBases = [
  projectRoot,
  path.resolve(projectRoot, "src"),
  process.cwd(),
  path.resolve(process.cwd(), "src"),
  path.resolve(process.cwd(), "tac-backend"),
  path.resolve(process.cwd(), "tac-backend/src"),
]
const envCandidates = envFileNames.flatMap((fileName) =>
  envBases.map((basePath) => path.resolve(basePath, fileName))
)
const loadedEnvPaths = new Set<string>()

for (const envPath of envCandidates) {
  if (!loadedEnvPaths.has(envPath) && fs.existsSync(envPath)) {
    const override = envPath.endsWith(".local")
    dotenv.config({ path: envPath, override })
    loadedEnvPaths.add(envPath)
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

function parseUrlList(value?: string) {
  if (!value) {
    return []
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(normalizeUrl)
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
const localFrontendOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]
const deployedFrontendOrigin = "https://tac-frontend-peach.vercel.app"
const deployedBackendUrl = "https://tac-backend-erf1.onrender.com"
const isProduction =
  nodeEnv === "production" ||
  isRenderDeployment ||
  isVercelDeployment
const defaultFrontendUrl = isProduction
  ? deployedFrontendOrigin
  : localFrontendOrigins[0]
const defaultFrontendOrigins = isProduction
  ? [deployedFrontendOrigin, ...localFrontendOrigins]
  : [...localFrontendOrigins, deployedFrontendOrigin]
const configuredFrontendOrigins = [
  ...parseUrlList(process.env.FRONTEND_URL),
  ...parseUrlList(process.env.FRONTEND_URLS),
]
const allowedFrontendOrigins = Array.from(
  new Set([...configuredFrontendOrigins, ...defaultFrontendOrigins])
)
const frontendUrl = normalizeUrl(
  process.env.FRONTEND_URL?.trim() ?? defaultFrontendUrl
)
const backendUrl = normalizeUrl(
  process.env.BACKEND_URL?.trim() ??
    (isProduction ? deployedBackendUrl : `http://localhost:${port}`)
)

export const env = {
  nodeEnv,
  port,
  allowedFrontendOrigins,
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
  isProduction,
}
