import type { Request, Response } from "express"

import { prisma } from "../lib/prisma"
import {
  formatApiKeyEnvironment,
  formatApiKeyStatus,
  hashApiKey,
  maskApiKey,
} from "../utils/apiKey"

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
  const submittedApiKey = parseSubmittedApiKey(req)

  if (!submittedApiKey) {
    res.status(401).json({ message: "API key is required." })
    return
  }

  const sender = readRequiredString(req.body.name ?? req.body.sender)
  const email = readRequiredString(req.body.email)
  const messageText = readRequiredString(req.body.message)
  const subject = readOptionalString(req.body.subject)
  const phone = readOptionalString(req.body.phone)
  const website = readOptionalString(req.body.website) ?? readOptionalString(req.header("origin"))

  if (!sender || !email || !messageText) {
    res.status(400).json({
      message: "name, email, and message are required.",
    })
    return
  }

  const apiKey = await prisma.apiKey.findUnique({
    where: {
      keyHash: hashApiKey(submittedApiKey),
    },
  })

  if (!apiKey) {
    res.status(401).json({ message: "Invalid API key." })
    return
  }

  if (apiKey.status === "REVOKED") {
    res.status(403).json({ message: "This API key has been revoked." })
    return
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
        email,
        ipAddress,
        message: messageText,
        origin: readOptionalString(req.header("origin")),
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

  res.status(201).json({
    message: "Message received successfully.",
    submission: {
      id: createdMessage.id,
      receivedAt: createdMessage.receivedAt.toISOString(),
    },
  })
}

async function listMessageFeeds(req: Request, res: Response) {
  const apiKeys = await prisma.apiKey.findMany({
    include: {
      messages: {
        orderBy: [{ receivedAt: "desc" }],
      },
    },
    where: {
      userId: req.auth!.userId,
    },
  })

  const feeds = apiKeys
    .map((apiKey) => ({
      apiKey: maskApiKey(apiKey.prefix, apiKey.lastFour),
      environment: formatApiKeyEnvironment(apiKey.environment),
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
