import type { Request, Response } from "express"
import { prisma } from "../lib/prisma"
import { getCachedOrFetch, invalidateUserCache, invalidateTeamCache } from "../lib/redis"
import {
  generateApiKey,
  parseApiKeyEnvironment,
} from "../utils/apiKey"

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

// Create a new team
export async function createTeam(req: Request, res: Response) {
  try {
    const { name } = req.body
    const userId = req.auth!.userId

    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ message: "Team name is required" })
      return
    }

    const team = await prisma.team.create({
      data: {
        name: name.trim(),
        members: {
          create: {
            userId,
            role: "OWNER",
          },
        },
      },
      include: {
        members: {
          include: {
            user: {
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
    })

    await invalidateUserCache(userId)

    res.status(201).json({
      message: "Team created successfully",
      team,
    })
  } catch (error) {
    console.error("Create team error:", error)
    res.status(500).json({ message: "Failed to create team" })
  }
}

// Get all teams for the current user
export async function listUserTeams(req: Request, res: Response) {
  try {
    const userId = req.auth!.userId

    const teams = await getCachedOrFetch(`user:teams:${userId}`, 86400, () =>
      prisma.team.findMany({
        where: {
          members: {
            some: {
              userId,
            },
          },
        },
        include: {
          members: {
            include: {
              user: {
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
          apiKeys: {
            where: { status: "ACTIVE" },
            select: {
              id: true,
              name: true,
              prefix: true,
              createdAt: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      })
    )

    res.json({
      teams,
    })
  } catch (error) {
    console.error("List teams error:", error)
    res.status(500).json({ message: "Failed to fetch teams" })
  }
}

// Get single team details
export async function getTeam(req: Request, res: Response) {
  try {
    const teamId = readParam(req.params.teamId)
    const userId = req.auth!.userId

    if (!teamId) {
      res.status(400).json({ message: "Team id is required" })
      return
    }

    // Check if user is a member of the team
    const membership = await getCachedOrFetch(`team:member_role:${teamId}:${userId}`, 3600, () =>
      prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId,
            userId,
          },
        },
      })
    )

    if (!membership) {
      res.status(403).json({ message: "You don't have access to this team" })
      return
    }

    const team = await getCachedOrFetch(`team:details:${teamId}`, 86400, () =>
      prisma.team.findUnique({
        where: { id: teamId },
        include: {
          members: {
            include: {
              user: {
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
          apiKeys: {
            select: {
              id: true,
              name: true,
              prefix: true,
              lastFour: true,
              status: true,
              environment: true,
              createdAt: true,
              lastUsedAt: true,
              fullKey: true,
            },
          },
        },
      })
    )

    if (!team) {
      res.status(404).json({ message: "Team not found" })
      return
    }

    res.json({ team })
  } catch (error) {
    console.error("Get team error:", error)
    res.status(500).json({ message: "Failed to fetch team" })
  }
}

function serializeTeamApiKey(apiKey: {
  createdAt: Date
  environment: "DEVELOPMENT" | "PRODUCTION"
  id: string
  lastFour: string
  lastUsedAt: Date | null
  name: string
  prefix: string
  status: "ACTIVE" | "REVOKED"
  fullKey?: string | null
}) {
  return {
    createdAt: apiKey.createdAt.toISOString(),
    environment: apiKey.environment,
    id: apiKey.id,
    lastFour: apiKey.lastFour,
    lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
    name: apiKey.name,
    prefix: apiKey.prefix,
    status: apiKey.status,
    fullKey: apiKey.fullKey ?? null,
  }
}

export async function createTeamApiKey(req: Request, res: Response) {
  try {
    const teamId = readParam(req.params.teamId)
    const name = typeof req.body.name === "string" ? req.body.name.trim() : ""
    const environment = parseApiKeyEnvironment(req.body.environment)
    const userId = req.auth!.userId

    if (!teamId) {
      res.status(400).json({ message: "Team id is required" })
      return
    }

    if (!name) {
      res.status(400).json({ message: "API key name is required" })
      return
    }

    if (!environment) {
      res.status(400).json({ message: "A valid API key environment is required" })
      return
    }

    const requesterMembership = await getCachedOrFetch(`team:member_role:${teamId}:${userId}`, 3600, () =>
      prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId,
            userId,
          },
        },
      })
    )

    if (!requesterMembership || requesterMembership.role === "MEMBER") {
      res.status(403).json({ message: "Only team owners and admins can create team API keys" })
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
        userId,
        teamId,
        fullKey: generatedKey.fullKey,
      },
    })

    await invalidateTeamCache(teamId)
    await invalidateUserCache(userId)

    res.status(201).json({
      apiKey: {
        ...serializeTeamApiKey(apiKey),
        fullKey: generatedKey.fullKey,
      },
    })
  } catch (error) {
    console.error("Create team API key error:", error)
    res.status(500).json({ message: "Failed to create team API key" })
  }
}

function serializeTeamInvite(invite: {
  id: string
  role: "OWNER" | "ADMIN" | "MEMBER"
  status: "PENDING" | "ACCEPTED" | "REJECTED"
  createdAt: Date
  respondedAt: Date | null
  team: {
    id: string
    name: string
  }
  invitedBy: {
    id: string
    name: string | null
    username?: string | null
    email: string
  }
}) {
  return {
    id: invite.id,
    role: invite.role,
    status: invite.status,
    createdAt: invite.createdAt.toISOString(),
    respondedAt: invite.respondedAt?.toISOString() ?? null,
    team: invite.team,
    invitedBy: invite.invitedBy,
  }
}

function serializeTeamNotification(notification: {
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
  recipients: Array<{
    readAt: Date | null
  }>
}) {
  return {
    id: notification.id,
    title: notification.title,
    message: notification.message,
    createdAt: notification.createdAt.toISOString(),
    team: notification.team,
    sender: notification.sender,
    recipientCount: notification.recipients.length,
    unreadRecipientCount: notification.recipients.filter(
      (recipient) => recipient.readAt === null
    ).length,
  }
}

export async function createTeamNotification(req: Request, res: Response) {
  try {
    const teamId = readParam(req.params.teamId)
    const title = typeof req.body.title === "string" ? req.body.title.trim() : ""
    const message =
      typeof req.body.message === "string" ? req.body.message.trim() : ""
    const userId = req.auth!.userId

    if (!teamId) {
      res.status(400).json({ message: "Team id is required" })
      return
    }

    if (!title) {
      res.status(400).json({ message: "Notification title is required" })
      return
    }

    if (!message) {
      res.status(400).json({ message: "Notification message is required" })
      return
    }

    if (title.length > 120) {
      res
        .status(400)
        .json({ message: "Notification title must be 120 characters or fewer" })
      return
    }

    if (message.length > 1000) {
      res
        .status(400)
        .json({ message: "Notification message must be 1000 characters or fewer" })
      return
    }

    const requesterMembership = await getCachedOrFetch(`team:member_role:${teamId}:${userId}`, 3600, () =>
      prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId,
            userId,
          },
        },
      })
    )

    if (!requesterMembership || requesterMembership.role === "MEMBER") {
      res
        .status(403)
        .json({ message: "Only team owners and admins can send notifications" })
      return
    }

    const teamMembers = await prisma.teamMember.findMany({
      where: {
        teamId,
      },
      select: {
        userId: true,
      },
    })

    const notification = await prisma.teamNotification.create({
      data: {
        teamId,
        senderId: userId,
        title,
        message,
        recipients: {
          create: teamMembers.map((member) => ({
            userId: member.userId,
            readAt: member.userId === userId ? new Date() : null,
          })),
        },
      },
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
        recipients: {
          select: {
            readAt: true,
          },
        },
      },
    })

    await invalidateTeamCache(teamId)
    for (const member of teamMembers) {
      await invalidateUserCache(member.userId)
    }

    res.status(201).json({
      message: "Notification sent successfully",
      notification: serializeTeamNotification(notification),
    })
  } catch (error) {
    console.error("Create team notification error:", error)
    res.status(500).json({ message: "Failed to send notification" })
  }
}

export async function listTeamNotifications(req: Request, res: Response) {
  try {
    const teamId = readParam(req.params.teamId)
    const userId = req.auth!.userId
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50)

    if (!teamId) {
      res.status(400).json({ message: "Team id is required" })
      return
    }

    const membership = await getCachedOrFetch(`team:member_role:${teamId}:${userId}`, 3600, () =>
      prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId,
            userId,
          },
        },
      })
    )

    if (!membership) {
      res.status(403).json({ message: "You don't have access to this team" })
      return
    }

    const notifications = await getCachedOrFetch(`team:notifications:${teamId}`, 300, () =>
      prisma.teamNotification.findMany({
        where: {
          teamId,
        },
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
          recipients: {
            select: {
              readAt: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: limit,
      })
    )

    res.json({
      notifications: notifications.map(serializeTeamNotification),
    })
  } catch (error) {
    console.error("List team notifications error:", error)
    res.status(500).json({ message: "Failed to fetch team notifications" })
  }
}

export async function addTeamMember(req: Request, res: Response) {
  try {
    const teamId = readParam(req.params.teamId)
    const { username, email, role = "MEMBER" } = req.body
    const userId = req.auth!.userId

    if (!teamId) {
      res.status(400).json({ message: "Team id is required" })
      return
    }

    if (!username && !email) {
      res.status(400).json({ message: "Username or email is required" })
      return
    }

    const requesterMembership = await getCachedOrFetch(`team:member_role:${teamId}:${userId}`, 3600, () =>
      prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId,
            userId,
          },
        },
      })
    )

    if (!requesterMembership || requesterMembership.role === "MEMBER") {
      res.status(403).json({ message: "You don't have permission to invite members" })
      return
    }

    // Try to find user by username first (case-insensitive), then by email
    let userToInvite = null
    
    if (username) {
      userToInvite = await prisma.user.findFirst({
        where: {
          OR: [
            { username: { equals: username, mode: 'insensitive' } },
            { email: { equals: username, mode: 'insensitive' } }
          ]
        }
      })
    }
    
    if (!userToInvite && email) {
      userToInvite = await prisma.user.findUnique({
        where: { email }
      })
    }

    if (!userToInvite) {
      const searchTerm = username || email
      res.status(404).json({ message: `User with username or email "${searchTerm}" not found. They may not have signed up yet.` })
      return
    }

    // Prevent inviting self
    if (userToInvite.id === userId) {
      res.status(400).json({ message: "You cannot invite yourself to the team" })
      return
    }

    const existingMember = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId: userToInvite.id,
        },
      },
    })

    if (existingMember) {
      res.status(400).json({ message: "User is already a member of this team" })
      return
    }

    const existingInvite = await prisma.teamInvite.findFirst({
      where: {
        teamId,
        invitedUserId: userToInvite.id,
        status: "PENDING",
      },
    })

    if (existingInvite) {
      res.status(400).json({ message: "This user already has a pending invitation" })
      return
    }

    const invite = await prisma.teamInvite.create({
      data: {
        teamId,
        invitedById: userId,
        invitedUserId: userToInvite.id,
        role,
      },
      include: {
        team: {
          select: {
            id: true,
            name: true,
          },
        },
        invitedBy: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
          },
        },
      },
    })

    await invalidateUserCache(userToInvite.id)

    res.status(201).json({
      message: "Invitation sent successfully",
      invite: serializeTeamInvite(invite),
    })
  } catch (error) {
    console.error("Add team member error:", error)
    res.status(500).json({ message: "Failed to send invitation" })
  }
}

export async function listUserInvites(req: Request, res: Response) {
  try {
    const userId = req.auth!.userId

    const invites = await getCachedOrFetch(`user:invites:${userId}`, 3600, () =>
      prisma.teamInvite.findMany({
        where: {
          invitedUserId: userId,
          status: "PENDING",
        },
        include: {
          team: {
            select: {
              id: true,
              name: true,
            },
          },
          invitedBy: {
            select: {
              id: true,
              name: true,
              username: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      })
    )

    res.json({
      invites: invites.map(serializeTeamInvite),
    })
  } catch (error) {
    console.error("List user invites error:", error)
    res.status(500).json({ message: "Failed to load invitations" })
  }
}

export async function acceptTeamInvite(req: Request, res: Response) {
  try {
    const inviteId = readParam(req.params.inviteId)
    const userId = req.auth!.userId

    if (!inviteId) {
      res.status(400).json({ message: "Invite id is required" })
      return
    }

    const invite = await prisma.teamInvite.findUnique({
      where: {
        id: inviteId,
      },
      include: {
        team: true,
      },
    })

    if (!invite || invite.invitedUserId !== userId) {
      res.status(404).json({ message: "Invitation not found" })
      return
    }

    if (invite.status !== "PENDING") {
      res.status(400).json({ message: "Invitation is no longer pending" })
      return
    }

    const existingMember = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId: invite.teamId,
          userId,
        },
      },
    })

    const invalidateInviteCaches = async () => {
      await invalidateUserCache(userId)
      await invalidateTeamCache(invite.teamId)
      const members = await prisma.teamMember.findMany({
        where: { teamId: invite.teamId },
        select: { userId: true }
      })
      for (const member of members) {
        await invalidateUserCache(member.userId)
      }
    }

    if (existingMember) {
      await prisma.teamInvite.update({
        where: { id: invite.id },
        data: {
          status: "ACCEPTED",
          respondedAt: new Date(),
        },
      })

      await invalidateInviteCaches()

      res.json({ message: "Invitation accepted" })
      return
    }

    await prisma.$transaction(async (tx) => {
      await tx.teamMember.create({
        data: {
          teamId: invite.teamId,
          userId,
          role: invite.role,
        },
      })

      await tx.teamInvite.update({
        where: { id: invite.id },
        data: {
          status: "ACCEPTED",
          respondedAt: new Date(),
        },
      })
    })

    await invalidateInviteCaches()

    res.json({ message: "Invitation accepted" })
  } catch (error) {
    console.error("Accept team invite error:", error)
    res.status(500).json({ message: "Failed to accept invitation" })
  }
}

// Remove member from team
export async function removeTeamMember(req: Request, res: Response) {
  try {
    const teamId = readParam(req.params.teamId)
    const memberId = readParam(req.params.memberId)
    const userId = req.auth!.userId

    if (!teamId || !memberId) {
      res.status(400).json({ message: "Team id and member id are required" })
      return
    }

    // Check if requester is admin or owner
    const requesterMembership = await getCachedOrFetch(`team:member_role:${teamId}:${userId}`, 3600, () =>
      prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId,
            userId,
          },
        },
      })
    )

    if (!requesterMembership || requesterMembership.role === "MEMBER") {
      res.status(403).json({ message: "You don't have permission to remove members" })
      return
    }

    // Check if trying to remove the only owner
    const memberToRemove = await prisma.teamMember.findUnique({
      where: { id: memberId },
    })

    if (memberToRemove?.role === "OWNER") {
      const ownerCount = await prisma.teamMember.count({
        where: {
          teamId,
          role: "OWNER",
        },
      })

      if (ownerCount === 1) {
        res.status(400).json({ message: "Cannot remove the only owner" })
        return
      }
    }

    await prisma.teamMember.delete({
      where: { id: memberId },
    })

    if (memberToRemove) {
      await invalidateUserCache(memberToRemove.userId)
    }
    await invalidateTeamCache(teamId)
    const members = await prisma.teamMember.findMany({
      where: { teamId },
      select: { userId: true }
    })
    for (const member of members) {
      await invalidateUserCache(member.userId)
    }

    res.json({ message: "Member removed successfully" })
  } catch (error) {
    console.error("Remove team member error:", error)
    res.status(500).json({ message: "Failed to remove member" })
  }
}

// Get team messages
export async function getTeamMessages(req: Request, res: Response) {
  try {
    const teamId = readParam(req.params.teamId)
    const userId = req.auth!.userId
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200)
    const offset = parseInt(req.query.offset as string) || 0

    if (!teamId) {
      res.status(400).json({ message: "Team id is required" })
      return
    }

    // Check if user is a member of the team
    const membership = await getCachedOrFetch(`team:member_role:${teamId}:${userId}`, 3600, () =>
      prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId,
            userId,
          },
        },
      })
    )

    if (!membership) {
      res.status(403).json({ message: "You don't have access to this team" })
      return
    }

    // Get all API keys for this team
    const apiKeys = await prisma.apiKey.findMany({
      where: {
        teamId,
        status: "ACTIVE",
      },
      select: { id: true },
    })

    const apiKeyIds = apiKeys.map((key) => key.id)

    // Get messages for all team API keys
    const messages = await getCachedOrFetch(`team:messages:${teamId}:limit:${limit}:offset:${offset}`, 30, () =>
      prisma.message.findMany({
        where: {
          apiKeyId: {
            in: apiKeyIds,
          },
        },
        include: {
          apiKey: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          receivedAt: "desc",
        },
        take: limit,
        skip: offset,
      })
    )

    const total = await getCachedOrFetch(`team:messages:${teamId}:count`, 30, () =>
      prisma.message.count({
        where: {
          apiKeyId: {
            in: apiKeyIds,
          },
        },
      })
    )

    res.json({
      messages: messages.map((msg) => ({
        id: msg.id,
        sender: msg.sender,
        email: msg.email,
        subject: msg.subject,
        message: msg.message,
        phone: msg.phone,
        website: msg.website,
        receivedAt: msg.receivedAt.toISOString(),
        apiKey: msg.apiKey,
      })),
      pagination: {
        limit,
        offset,
        total,
      },
    })
  } catch (error) {
    console.error("Get team messages error:", error)
    res.status(500).json({ message: "Failed to fetch team messages" })
  }
}

// Update team name (owner only)
export async function updateTeam(req: Request, res: Response) {
  try {
    const teamId = readParam(req.params.teamId)
    const { name } = req.body
    const userId = req.auth!.userId

    if (!teamId) {
      res.status(400).json({ message: "Team id is required" })
      return
    }

    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ message: "Team name is required" })
      return
    }

    // Check if requester is owner
    const membership = await getCachedOrFetch(`team:member_role:${teamId}:${userId}`, 3600, () =>
      prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId,
            userId,
          },
        },
      })
    )

    if (!membership || membership.role !== "OWNER") {
      res.status(403).json({ message: "Only owners can update team details" })
      return
    }

    const team = await prisma.team.update({
      where: { id: teamId },
      data: {
        name: name.trim(),
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                picture: true,
              },
            },
          },
        },
      },
    })

    await invalidateTeamCache(teamId)
    const members = await prisma.teamMember.findMany({
      where: { teamId },
      select: { userId: true }
    })
    for (const member of members) {
      await invalidateUserCache(member.userId)
    }

    res.json({
      message: "Team updated successfully",
      team,
    })
  } catch (error) {
    console.error("Update team error:", error)
    res.status(500).json({ message: "Failed to update team" })
  }
}
