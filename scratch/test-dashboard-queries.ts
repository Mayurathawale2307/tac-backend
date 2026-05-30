process.env.DATABASE_URL = "postgresql://neondb_owner:npg_lwerkidF93Bh@ep-polished-moon-aoj3jlwu-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

import "../src/config/env"
import { prisma } from "../src/lib/prisma"
import { getCachedOrFetch } from "../src/lib/redis"

// Serializer mimics
function serializeApiKey(apiKey: any) {
  return {
    createdAt: apiKey.createdAt.toISOString(),
    id: apiKey.id,
    name: apiKey.name,
  }
}

function serializeMessage(message: any) {
  return {
    id: message.id,
    receivedAt: message.receivedAt.toISOString(),
  }
}

async function testDashboardQueries() {
  const userId = "cmpftce680000ubmodlzvat9l" // Mayur Athawale

  console.log("Starting Dashboard Queries simulation...")

  // 1. Simulate listApiKeys
  try {
    console.log("--- 1. Simulating listApiKeys ---")
    const cacheKey = `user:apikeys:${userId}`
    const apiKeys = await getCachedOrFetch(cacheKey, 86400, () =>
      prisma.apiKey.findMany({
        orderBy: [{ createdAt: "desc" }],
        where: {
          userId,
        },
      })
    )
    console.log("Found API Keys count:", apiKeys.length)
    const serialized = apiKeys.map(serializeApiKey)
    console.log("Successfully serialized API keys!")
  } catch (error) {
    console.error("FAILED in listApiKeys:", error)
  }

  // 2. Simulate listMessageFeeds
  try {
    console.log("--- 2. Simulating listMessageFeeds ---")
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
    console.log("Found feeds count:", apiKeys.length)
    const feeds = apiKeys.map((apiKey: any) => ({
      id: apiKey.id,
      messages: apiKey.messages.map(serializeMessage),
    }))
    console.log("Successfully serialized message feeds!")
  } catch (error) {
    console.error("FAILED in listMessageFeeds:", error)
  }

  // 3. Simulate listOperations
  try {
    console.log("--- 3. Simulating listOperations ---")
    const memberships = await prisma.teamMember.findMany({
      select: {
        teamId: true,
      },
      where: {
        userId,
      },
    })
    const teamIds = memberships.map((m) => m.teamId)
    console.log("Team IDs:", teamIds)

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
          take: 200,
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
    console.log("Successfully ran listOperations DB queries!")
  } catch (error) {
    console.error("FAILED in listOperations:", error)
  }
}

testDashboardQueries().then(() => prisma.$disconnect())
