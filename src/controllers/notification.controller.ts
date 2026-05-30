import type { Request, Response } from "express"

import { prisma } from "../lib/prisma"
import { getCachedOrFetch, invalidateUserCache } from "../lib/redis"

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function serializeUserNotification(recipient: {
  readAt: Date | null
  notification: {
    id: string
    title: string
    message: string
    createdAt: Date
    team: {
      id: string
      name: string
    }
    sender: {
      id: string
      name: string | null
      username: string | null
      email: string
      picture: string | null
    }
  }
}) {
  return {
    id: recipient.notification.id,
    title: recipient.notification.title,
    message: recipient.notification.message,
    createdAt: recipient.notification.createdAt.toISOString(),
    readAt: recipient.readAt?.toISOString() ?? null,
    team: recipient.notification.team,
    sender: recipient.notification.sender,
  }
}

export async function listUserNotifications(req: Request, res: Response) {
  try {
    const userId = req.auth!.userId
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100)

    const recipients = await getCachedOrFetch(`user:notifications:${userId}`, 300, () =>
      prisma.teamNotificationRecipient.findMany({
        where: {
          userId,
        },
        include: {
          notification: {
            include: {
              team: {
                select: {
                  id: true,
                  name: true,
                },
              },
              sender: {
                select: {
                  id: true,
                  name: true,
                  username: true,
                  email: true,
                  picture: true,
                },
              },
            },
          },
        },
        orderBy: {
          notification: {
            createdAt: "desc",
          },
        },
        take: limit,
      })
    )

    const unreadCount = await getCachedOrFetch(`user:notifications:unread_count:${userId}`, 300, () =>
      prisma.teamNotificationRecipient.count({
        where: {
          userId,
          readAt: null,
        },
      })
    )

    res.json({
      notifications: recipients.map(serializeUserNotification),
      unreadCount,
    })
  } catch (error) {
    console.error("List user notifications error:", error)
    res.status(500).json({ message: "Failed to load notifications" })
  }
}

export async function markNotificationRead(req: Request, res: Response) {
  try {
    const notificationId = readParam(req.params.notificationId)
    const userId = req.auth!.userId

    if (!notificationId) {
      res.status(400).json({ message: "Notification id is required" })
      return
    }

    const recipient = await prisma.teamNotificationRecipient.findFirst({
      where: {
        notificationId,
        userId,
      },
    })

    if (!recipient) {
      res.status(404).json({ message: "Notification not found" })
      return
    }

    if (recipient.readAt) {
      res.status(204).send()
      return
    }

    await prisma.teamNotificationRecipient.update({
      where: {
        notificationId_userId: {
          notificationId,
          userId,
        },
      },
      data: {
        readAt: new Date(),
      },
    })

    await invalidateUserCache(userId)

    res.status(204).send()
  } catch (error) {
    console.error("Mark notification read error:", error)
    res.status(500).json({ message: "Failed to mark notification as read" })
  }
}

export async function markAllNotificationsRead(req: Request, res: Response) {
  try {
    const userId = req.auth!.userId

    const result = await prisma.teamNotificationRecipient.updateMany({
      where: {
        userId,
        readAt: null,
      },
      data: {
        readAt: new Date(),
      },
    })

    await invalidateUserCache(userId)

    res.json({
      updatedCount: result.count,
    })
  } catch (error) {
    console.error("Mark all notifications read error:", error)
    res.status(500).json({ message: "Failed to mark notifications as read" })
  }
}
