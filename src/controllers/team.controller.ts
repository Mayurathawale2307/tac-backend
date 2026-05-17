import type { Request, Response } from "express"
import { prisma } from "../lib/prisma"

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
                email: true,
                picture: true,
              },
            },
          },
        },
      },
    })

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

    const teams = await prisma.team.findMany({
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
    const membership = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId,
        },
      },
    })

    if (!membership) {
      res.status(403).json({ message: "You don't have access to this team" })
      return
    }

    const team = await prisma.team.findUnique({
      where: { id: teamId },
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
          },
        },
      },
    })

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

// Add member to team
export async function addTeamMember(req: Request, res: Response) {
  try {
    const teamId = readParam(req.params.teamId)
    const { email, role = "MEMBER" } = req.body
    const userId = req.auth!.userId

    if (!teamId) {
      res.status(400).json({ message: "Team id is required" })
      return
    }

    if (!email || typeof email !== "string") {
      res.status(400).json({ message: "Email is required" })
      return
    }

    // Check if requester is admin or owner
    const requesterMembership = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId,
        },
      },
    })

    if (!requesterMembership || requesterMembership.role === "MEMBER") {
      res.status(403).json({ message: "You don't have permission to add members" })
      return
    }

    // Find the user to add
    const userToAdd = await prisma.user.findUnique({
      where: { email },
    })

    if (!userToAdd) {
      res.status(404).json({ message: "User with this email not found" })
      return
    }

    // Check if already a member
    const existingMember = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId: userToAdd.id,
        },
      },
    })

    if (existingMember) {
      res.status(400).json({ message: "User is already a member of this team" })
      return
    }

    const member = await prisma.teamMember.create({
      data: {
        teamId,
        userId: userToAdd.id,
        role,
      },
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
    })

    res.status(201).json({
      message: "Member added successfully",
      member,
    })
  } catch (error) {
    console.error("Add team member error:", error)
    res.status(500).json({ message: "Failed to add member" })
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
    const requesterMembership = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId,
        },
      },
    })

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
    const membership = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId,
        },
      },
    })

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
    const messages = await prisma.message.findMany({
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

    const total = await prisma.message.count({
      where: {
        apiKeyId: {
          in: apiKeyIds,
        },
      },
    })

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
    const membership = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId,
        },
      },
    })

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

    res.json({
      message: "Team updated successfully",
      team,
    })
  } catch (error) {
    console.error("Update team error:", error)
    res.status(500).json({ message: "Failed to update team" })
  }
}
