import type { Request, Response } from "express"

import { prisma } from "../lib/prisma"
import { getCachedOrFetch, invalidateUserCache, invalidateApiKeyCache, invalidateTeamCache } from "../lib/redis"
import {
  normalizeApiKeyFormFields,
  readApiKeyFormFields,
} from "../utils/formFields"
import {
  formatApiKeyEnvironment,
  formatApiKeyStatus,
  generateApiKey,
  maskApiKey,
  parseApiKeyEnvironment,
} from "../utils/apiKey"

function serializeApiKey(apiKey: {
  createdAt: Date
  environment: "DEVELOPMENT" | "PRODUCTION"
  id: string
  lastFour: string
  lastUsedAt: Date | null
  name: string
  formFields?: unknown
  prefix: string
  status: "ACTIVE" | "REVOKED"
  fullKey?: string | null
}) {
  return {
    createdAt: apiKey.createdAt.toISOString(),
    environment: formatApiKeyEnvironment(apiKey.environment),
    formFields: readApiKeyFormFields(apiKey.formFields),
    id: apiKey.id,
    lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
    maskedKey: maskApiKey(apiKey.prefix, apiKey.lastFour),
    name: apiKey.name,
    status: formatApiKeyStatus(apiKey.status),
    fullKey: apiKey.fullKey ?? null,
  }
}

async function listApiKeys(req: Request, res: Response) {
  const userId = req.auth!.userId
  const cacheKey = `user:apikeys:${userId}`
  const apiKeys = await getCachedOrFetch(cacheKey, 86400, () =>
    prisma.apiKey.findMany({
      orderBy: [{ createdAt: "desc" }],
      where: {
        userId,
      },
    })
  )

  res.json({
    apiKeys: apiKeys.map(serializeApiKey),
  })
}

async function createApiKeyRecord(req: Request, res: Response) {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : ""
  const environment = parseApiKeyEnvironment(req.body.environment)

  if (!name) {
    res.status(400).json({ message: "API key name is required." })
    return
  }

  if (name.length > 80) {
    res.status(400).json({ message: "API key name must be 80 characters or less." })
    return
  }

  if (!environment) {
    res.status(400).json({ message: "A valid API key environment is required." })
    return
  }

  const generatedKey = generateApiKey(environment)

  const apiKey = await prisma.apiKey.create({
    data: {
      environment,
      keyHash: generatedKey.keyHash,
      lastFour: generatedKey.lastFour,
      name,
      prefix: generatedKey.prefix,
      userId: req.auth!.userId,
      fullKey: generatedKey.fullKey,
    },
  })

  await invalidateUserCache(req.auth!.userId)

  res.status(201).json({
    apiKey: {
      ...serializeApiKey(apiKey),
      fullKey: generatedKey.fullKey,
    },
  })
}

async function updateApiKeyFormFields(req: Request, res: Response) {
  const apiKeyId = Array.isArray(req.params.apiKeyId)
    ? req.params.apiKeyId[0]
    : req.params.apiKeyId

  if (!apiKeyId) {
    res.status(400).json({ message: "API key id is required." })
    return
  }

  const existingApiKey = await prisma.apiKey.findFirst({
    where: {
      id: apiKeyId,
      userId: req.auth!.userId,
    },
  })

  if (!existingApiKey) {
    res.status(404).json({ message: "API key not found." })
    return
  }

  const formFields = normalizeApiKeyFormFields(req.body.formFields)

  const apiKey = await prisma.apiKey.update({
    data: {
      formFields,
    },
    where: {
      id: existingApiKey.id,
    },
  })

  await invalidateUserCache(req.auth!.userId)
  await invalidateApiKeyCache(apiKey.keyHash)
  if (apiKey.teamId) {
    await invalidateTeamCache(apiKey.teamId)
  }

  res.json({
    apiKey: serializeApiKey(apiKey),
  })
}

async function revokeApiKeyRecord(req: Request, res: Response) {
  const apiKeyId = Array.isArray(req.params.apiKeyId)
    ? req.params.apiKeyId[0]
    : req.params.apiKeyId

  if (!apiKeyId) {
    res.status(400).json({ message: "API key id is required." })
    return
  }

  const existingApiKey = await prisma.apiKey.findFirst({
    where: {
      id: apiKeyId,
      userId: req.auth!.userId,
    },
  })

  if (!existingApiKey) {
    res.status(404).json({ message: "API key not found." })
    return
  }

  const apiKey = await prisma.apiKey.update({
    data: {
      status: "REVOKED",
    },
    where: {
      id: existingApiKey.id,
    },
  })

  await invalidateUserCache(req.auth!.userId)
  await invalidateApiKeyCache(apiKey.keyHash)
  if (apiKey.teamId) {
    await invalidateTeamCache(apiKey.teamId)
  }

  res.json({
    apiKey: serializeApiKey(apiKey),
  })
}

async function deleteApiKeyRecord(req: Request, res: Response) {
  const apiKeyId = Array.isArray(req.params.apiKeyId)
    ? req.params.apiKeyId[0]
    : req.params.apiKeyId

  if (!apiKeyId) {
    res.status(400).json({ message: "API key id is required." })
    return
  }

  const existingApiKey = await prisma.apiKey.findFirst({
    where: {
      id: apiKeyId,
      userId: req.auth!.userId,
    },
  })

  if (!existingApiKey) {
    res.status(404).json({ message: "API key not found." })
    return
  }

  await prisma.apiKey.delete({
    where: {
      id: existingApiKey.id,
    },
  })

  await invalidateUserCache(req.auth!.userId)
  await invalidateApiKeyCache(existingApiKey.keyHash)
  if (existingApiKey.teamId) {
    await invalidateTeamCache(existingApiKey.teamId)
  }

  res.status(204).send()
}

export {
  createApiKeyRecord,
  deleteApiKeyRecord,
  listApiKeys,
  revokeApiKeyRecord,
  updateApiKeyFormFields,
}
