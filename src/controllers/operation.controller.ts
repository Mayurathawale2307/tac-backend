import type { Request, Response } from "express"

import { prisma } from "../lib/prisma"
import { formatApiKeyEnvironment } from "../utils/apiKey"

type OperationType =
  | "api_key_created"
  | "api_key_revoked"
  | "message_received"
  | "team_created"
  | "team_invite_received"
  | "team_member_invited"
  | "team_member_joined"
  | "team_invite_accepted"
  | "team_api_key_created"
  | "team_api_key_revoked"

type OperationCategory = "api_keys" | "messages" | "team"
type OperationScope = "personal" | "team"

type OperationRecord = {
  category: OperationCategory
  description: string
  id: string
  occurredAt: string
  scope: OperationScope
  team: {
    id: string
    name: string
  } | null
  title: string
  type: OperationType
}

function formatTeamRole(role: "OWNER" | "ADMIN" | "MEMBER") {
  if (role === "OWNER") {
    return "Owner"
  }

  if (role === "ADMIN") {
    return "Write"
  }

  return "Read"
}

function formatUserLabel(user: {
  email: string
  name: string | null
  username?: string | null
}) {
  return user.name ?? user.username ?? user.email
}

function pushOperation(
  operations: OperationRecord[],
  operation: Omit<OperationRecord, "occurredAt"> & { occurredAt: Date }
) {
  operations.push({
    ...operation,
    occurredAt: operation.occurredAt.toISOString(),
  })
}

async function listOperations(req: Request, res: Response) {
  const rawLimit =
    typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : NaN
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, 500)
      : 200
  const userId = req.auth!.userId

  const memberships = await prisma.teamMember.findMany({
    select: {
      teamId: true,
    },
    where: {
      userId,
    },
  })

  const teamIds = memberships.map((membership) => membership.teamId)

  const [personalApiKeys, teams, pendingReceivedInvites, messages] =
    await Promise.all([
      prisma.apiKey.findMany({
        orderBy: [{ createdAt: "desc" }],
        select: {
          createdAt: true,
          environment: true,
          id: true,
          name: true,
          status: true,
          updatedAt: true,
        },
        where: {
          teamId: null,
          userId,
        },
      }),
      prisma.team.findMany({
        orderBy: [{ createdAt: "desc" }],
        select: {
          apiKeys: {
            orderBy: [{ createdAt: "desc" }],
            select: {
              createdAt: true,
              environment: true,
              id: true,
              name: true,
              status: true,
              updatedAt: true,
            },
          },
          createdAt: true,
          id: true,
          invites: {
            orderBy: [{ createdAt: "desc" }],
            select: {
              createdAt: true,
              id: true,
              invitedBy: {
                select: {
                  email: true,
                  name: true,
                  username: true,
                },
              },
              invitedUser: {
                select: {
                  email: true,
                  name: true,
                  username: true,
                },
              },
              respondedAt: true,
              role: true,
              status: true,
            },
          },
          members: {
            orderBy: [{ joinedAt: "desc" }],
            select: {
              id: true,
              joinedAt: true,
              role: true,
              user: {
                select: {
                  email: true,
                  id: true,
                  name: true,
                  username: true,
                },
              },
            },
          },
          name: true,
        },
        where: {
          id: {
            in: teamIds.length > 0 ? teamIds : ["__none__"],
          },
        },
      }),
      prisma.teamInvite.findMany({
        orderBy: [{ createdAt: "desc" }],
        select: {
          createdAt: true,
          id: true,
          invitedBy: {
            select: {
              email: true,
              name: true,
              username: true,
            },
          },
          role: true,
          team: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        where: {
          invitedUserId: userId,
          status: "PENDING",
        },
      }),
      prisma.message.findMany({
        include: {
          apiKey: {
            select: {
              id: true,
              name: true,
              team: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
        orderBy: [{ receivedAt: "desc" }],
        take: limit,
        where: {
          OR: [
            {
              apiKey: {
                teamId: null,
                userId,
              },
            },
            ...(teamIds.length > 0
              ? [
                  {
                    apiKey: {
                      teamId: {
                        in: teamIds,
                      },
                    },
                  },
                ]
              : []),
          ],
        },
      }),
    ])

  const operations: OperationRecord[] = []

  for (const apiKey of personalApiKeys) {
    pushOperation(operations, {
      category: "api_keys",
      description: `${apiKey.name} was created for ${formatApiKeyEnvironment(apiKey.environment)} use.`,
      id: `api_key_created:${apiKey.id}`,
      occurredAt: apiKey.createdAt,
      scope: "personal",
      team: null,
      title: "API key created",
      type: "api_key_created",
    })

    if (apiKey.status === "REVOKED") {
      pushOperation(operations, {
        category: "api_keys",
        description: `${apiKey.name} was revoked and can no longer be used for authenticated requests.`,
        id: `api_key_revoked:${apiKey.id}`,
        occurredAt: apiKey.updatedAt,
        scope: "personal",
        team: null,
        title: "API key revoked",
        type: "api_key_revoked",
      })
    }
  }

  for (const team of teams) {
    pushOperation(operations, {
      category: "team",
      description: `${team.name} was created and is now available for collaboration.`,
      id: `team_created:${team.id}`,
      occurredAt: team.createdAt,
      scope: "team",
      team: {
        id: team.id,
        name: team.name,
      },
      title: "Team created",
      type: "team_created",
    })

    for (const member of team.members) {
      const isOwnerCreatedWithTeam =
        member.role === "OWNER" &&
        member.user.id === userId &&
        Math.abs(member.joinedAt.getTime() - team.createdAt.getTime()) < 60_000

      if (isOwnerCreatedWithTeam) {
        continue
      }

      pushOperation(operations, {
        category: "team",
        description: `${formatUserLabel(member.user)} joined ${team.name} with ${formatTeamRole(member.role)} access.`,
        id: `team_member_joined:${member.id}`,
        occurredAt: member.joinedAt,
        scope: "team",
        team: {
          id: team.id,
          name: team.name,
        },
        title: "Team member joined",
        type: "team_member_joined",
      })
    }

    for (const invite of team.invites) {
      pushOperation(operations, {
        category: "team",
        description: `${formatUserLabel(invite.invitedBy)} invited ${formatUserLabel(invite.invitedUser)} to ${team.name} with ${formatTeamRole(invite.role)} access.`,
        id: `team_member_invited:${invite.id}`,
        occurredAt: invite.createdAt,
        scope: "team",
        team: {
          id: team.id,
          name: team.name,
        },
        title: "Team invite sent",
        type: "team_member_invited",
      })

      if (invite.status === "ACCEPTED" && invite.respondedAt) {
        pushOperation(operations, {
          category: "team",
          description: `${formatUserLabel(invite.invitedUser)} accepted the invitation to join ${team.name}.`,
          id: `team_invite_accepted:${invite.id}`,
          occurredAt: invite.respondedAt,
          scope: "team",
          team: {
            id: team.id,
            name: team.name,
          },
          title: "Team invite accepted",
          type: "team_invite_accepted",
        })
      }
    }

    for (const apiKey of team.apiKeys) {
      pushOperation(operations, {
        category: "api_keys",
        description: `${apiKey.name} was created for ${team.name} in ${formatApiKeyEnvironment(apiKey.environment)}.`,
        id: `team_api_key_created:${apiKey.id}`,
        occurredAt: apiKey.createdAt,
        scope: "team",
        team: {
          id: team.id,
          name: team.name,
        },
        title: "Team API key created",
        type: "team_api_key_created",
      })

      if (apiKey.status === "REVOKED") {
        pushOperation(operations, {
          category: "api_keys",
          description: `${apiKey.name} was revoked for ${team.name}.`,
          id: `team_api_key_revoked:${apiKey.id}`,
          occurredAt: apiKey.updatedAt,
          scope: "team",
          team: {
            id: team.id,
            name: team.name,
          },
          title: "Team API key revoked",
          type: "team_api_key_revoked",
        })
      }
    }
  }

  for (const invite of pendingReceivedInvites) {
    pushOperation(operations, {
      category: "team",
      description: `${formatUserLabel(invite.invitedBy)} invited you to ${invite.team.name} with ${formatTeamRole(invite.role)} access.`,
      id: `team_invite_received:${invite.id}`,
      occurredAt: invite.createdAt,
      scope: "team",
      team: invite.team,
      title: "Team invite received",
      type: "team_invite_received",
    })
  }

  for (const message of messages) {
    pushOperation(operations, {
      category: "messages",
      description: `${message.sender} submitted a message through ${message.apiKey.name}.`,
      id: `message_received:${message.id}`,
      occurredAt: message.receivedAt,
      scope: message.apiKey.team ? "team" : "personal",
      team: message.apiKey.team,
      title: "Message received",
      type: "message_received",
    })
  }

  operations.sort(
    (left, right) =>
      new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()
  )

  res.json({
    operations: operations.slice(0, limit),
  })
}

export { listOperations }
