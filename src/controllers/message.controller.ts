import type { Request, Response } from "express"

import { prisma } from "../lib/prisma"
import { getCachedOrFetch, cache, invalidateTeamCache } from "../lib/redis"
import {
  readApiKeyFormFields,
  type SubmittedCustomField,
} from "../utils/formFields"
import {
  formatApiKeyEnvironment,
  formatApiKeyStatus,
  hashApiKey,
  maskApiKey,
} from "../utils/apiKey"
import { buildUploadUrl, removeUploadedFiles } from "../utils/uploads"

function readOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null
  }

  const trimmedValue = value.trim()
  return trimmedValue ? trimmedValue : null
}

function readRequiredString(value: unknown) {
  return readOptionalString(value) ?? ""
}

function readUploadedFiles(req: Request) {
  const requestWithFiles = req as Request & { files?: Express.Multer.File[] }
  return Array.isArray(requestWithFiles.files) ? requestWithFiles.files : []
}

function parseSubmittedApiKey(req: Request) {
  const headerValue = req.header("x-api-key")

  if (headerValue) {
    return headerValue.trim()
  }

  const authorizationHeader = req.header("authorization")

  if (!authorizationHeader) {
    return ""
  }

  const [scheme, token] = authorizationHeader.split(" ")

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return ""
  }

  return token.trim()
}

function serializeMessage(message: {
  customFields?: unknown
  email: string
  id: string
  message: string
  phone: string | null
  receivedAt: Date
  sender: string
  subject: string | null
  website: string | null
}) {
  return {
    customFields: Array.isArray(message.customFields)
      ? (message.customFields as SubmittedCustomField[])
      : [],
    email: message.email,
    id: message.id,
    message: message.message,
    phone: message.phone,
    receivedAt: message.receivedAt.toISOString(),
    sender: message.sender,
    subject: message.subject,
    website: message.website,
  }
}

async function submitMessage(req: Request, res: Response) {
  const uploadedFiles = readUploadedFiles(req)

  try {
  const submittedApiKey = parseSubmittedApiKey(req)

  if (!submittedApiKey) {
    await removeUploadedFiles(uploadedFiles)
    res.status(401).json({ message: "API key is required." })
    return
  }

  const sender = readRequiredString(req.body.name ?? req.body.sender)
  const email = readRequiredString(req.body.email)
  const messageText = readRequiredString(req.body.message)
  const subject = readOptionalString(req.body.subject)
  const phone = readOptionalString(req.body.phone)
  const origin = readOptionalString(req.header("origin"))
  const website = readOptionalString(req.body.website) ?? origin

  if (!sender || !email || !messageText) {
    await removeUploadedFiles(uploadedFiles)
    res.status(400).json({
      message: "name, email, and message are required.",
    })
    return
  }

  const keyHash = hashApiKey(submittedApiKey)
  const apiKey = await getCachedOrFetch(`apikey:hash:${keyHash}`, 86400, () =>
    prisma.apiKey.findUnique({
      where: {
        keyHash,
      },
    })
  )

  if (!apiKey) {
    await removeUploadedFiles(uploadedFiles)
    res.status(401).json({ message: "Invalid API key." })
    return
  }

  if (apiKey.status === "REVOKED") {
    await removeUploadedFiles(uploadedFiles)
    res.status(403).json({ message: "This API key has been revoked." })
    return
  }

  const configuredFormFields = readApiKeyFormFields(apiKey.formFields)
  const submittedCustomFields: SubmittedCustomField[] = []
  const usedFilePaths = new Set<string>()

  for (const field of configuredFormFields) {
    if (field.type === "file") {
      const uploadedFile = uploadedFiles.find((file) => file.fieldname === field.name)

      if (field.required && !uploadedFile) {
        await removeUploadedFiles(uploadedFiles)
        res.status(400).json({
          message: `${field.label} is required.`,
        })
        return
      }

      if (uploadedFile) {
        usedFilePaths.add(uploadedFile.path)
        submittedCustomFields.push({
          fieldId: field.id,
          fileName: uploadedFile.originalname,
          fileUrl: buildUploadUrl(uploadedFile.filename),
          label: field.label,
          mimeType: uploadedFile.mimetype,
          name: field.name,
          size: uploadedFile.size,
          type: field.type,
        })
      }

      continue
    }

    const value = readOptionalString(req.body[field.name])

    if (field.required && !value) {
      await removeUploadedFiles(uploadedFiles)
      res.status(400).json({
        message: `${field.label} is required.`,
      })
      return
    }

    if (value) {
      submittedCustomFields.push({
        fieldId: field.id,
        label: field.label,
        name: field.name,
        type: field.type,
        value,
      })
    }
  }

  const unusedFiles = uploadedFiles.filter((file) => !usedFilePaths.has(file.path))

  if (unusedFiles.length > 0) {
    await removeUploadedFiles(unusedFiles)
  }

  const ipAddressHeader = req.header("x-forwarded-for")
  const ipAddress = ipAddressHeader
    ? ipAddressHeader.split(",")[0]?.trim() ?? null
    : req.socket.remoteAddress ?? null

  const now = new Date()

  const createdMessage = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        apiKeyId: apiKey.id,
        customFields:
          submittedCustomFields.length > 0 ? submittedCustomFields : undefined,
        email,
        ipAddress,
        message: messageText,
        origin,
        phone,
        sender,
        subject,
        userAgent: readOptionalString(req.header("user-agent")),
        website,
      },
    })

    await tx.apiKey.update({
      data: {
        lastUsedAt: now,
      },
      where: {
        id: apiKey.id,
      },
    })

    return message
  })

  // Evict cache to reflect the new message
  if (apiKey.userId) {
    await cache.del(`user:feeds:${apiKey.userId}`)
  }
  if (apiKey.teamId) {
    await invalidateTeamCache(apiKey.teamId)
    const members = await prisma.teamMember.findMany({
      where: {
        teamId: apiKey.teamId,
      },
      select: {
        userId: true,
      },
    })
    for (const member of members) {
      await cache.del(`user:feeds:${member.userId}`)
    }
  }

  res.status(201).json({
    message: "Message received successfully.",
    submission: {
      id: createdMessage.id,
      receivedAt: createdMessage.receivedAt.toISOString(),
    },
  })
  } catch (error) {
    await removeUploadedFiles(uploadedFiles)
    console.error("Submit message error:", error)
    res.status(500).json({ message: "Unable to receive message." })
  }
}

async function listMessageFeeds(req: Request, res: Response) {
  const userId = req.auth!.userId
  const cacheKey = `user:feeds:${userId}`
  const apiKeys = await getCachedOrFetch(cacheKey, 300, () =>
    prisma.apiKey.findMany({
      include: {
        messages: {
          orderBy: [{ receivedAt: "desc" }],
        },
      },
      where: {
        userId,
      },
    })
  )

  const feeds = apiKeys
    .map((apiKey) => ({
      apiKey: maskApiKey(apiKey.prefix, apiKey.lastFour),
      environment: formatApiKeyEnvironment(apiKey.environment),
      formFields: readApiKeyFormFields(apiKey.formFields),
      id: apiKey.id,
      keyName: apiKey.name,
      lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
      messageCount: apiKey.messages.length,
      messages: apiKey.messages.map(serializeMessage),
      status: formatApiKeyStatus(apiKey.status),
    }))
    .sort((left, right) => {
      const leftTimestamp =
        left.messages[0]?.receivedAt ?? left.lastUsedAt ?? ""
      const rightTimestamp =
        right.messages[0]?.receivedAt ?? right.lastUsedAt ?? ""

      return rightTimestamp.localeCompare(leftTimestamp)
    })

  res.json({ feeds })
}

export { listMessageFeeds, submitMessage }
