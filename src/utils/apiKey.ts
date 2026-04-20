import crypto from "node:crypto"

import type { ApiKeyEnvironment, ApiKeyStatus } from "@prisma/client"

function buildApiKeyPrefix(environment: ApiKeyEnvironment) {
  return environment === "PRODUCTION" ? "sk_live_" : "sk_test_"
}

function hashApiKey(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

function generateApiKey(environment: ApiKeyEnvironment) {
  const prefix = buildApiKeyPrefix(environment)
  const secret = crypto.randomBytes(24).toString("base64url")
  const fullKey = `${prefix}${secret}`

  return {
    fullKey,
    keyHash: hashApiKey(fullKey),
    lastFour: fullKey.slice(-4),
    prefix,
  }
}

function maskApiKey(prefix: string, lastFour: string) {
  return `${prefix}****${lastFour}`
}

function parseApiKeyEnvironment(value: unknown): ApiKeyEnvironment | null {
  if (typeof value !== "string") {
    return null
  }

  if (value === "Production" || value === "PRODUCTION") {
    return "PRODUCTION"
  }

  if (value === "Development" || value === "DEVELOPMENT") {
    return "DEVELOPMENT"
  }

  return null
}

function formatApiKeyEnvironment(environment: ApiKeyEnvironment) {
  return environment === "PRODUCTION" ? "Production" : "Development"
}

function formatApiKeyStatus(status: ApiKeyStatus) {
  return status === "ACTIVE" ? "Active" : "Revoked"
}

export {
  formatApiKeyEnvironment,
  formatApiKeyStatus,
  generateApiKey,
  hashApiKey,
  maskApiKey,
  parseApiKeyEnvironment,
}
