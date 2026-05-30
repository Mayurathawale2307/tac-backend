process.env.DATABASE_URL = "postgresql://neondb_owner:npg_lwerkidF93Bh@ep-polished-moon-aoj3jlwu-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

import "../src/config/env"
import { prisma } from "../src/lib/prisma"
import { getCachedOrFetch, invalidateUserCache } from "../src/lib/redis"

async function testAddTeamMember() {
  const teamId = "cmpftnken0006ubmsu4x12r18" // Best team
  const userId = "cmpftce680000ubmodlzvat9l" // Mayur
  const inviteUsername = "cjatin015" // Jatin
  const role = "MEMBER"

  console.log("Starting addTeamMember simulation on Neon...")
  
  try {
    // 1. Check membership via getCachedOrFetch
    console.log("Checking requester membership cache...")
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
    console.log("Requester Membership:", requesterMembership)

    // 2. Find user to invite
    console.log("Finding user to invite...")
    const userToInvite = await prisma.user.findUnique({
      where: { username: inviteUsername },
    })
    console.log("User to invite:", userToInvite)

    if (!userToInvite) {
      console.log("User not found!")
      return
    }

    // 3. Check existing member
    console.log("Checking existing member...")
    const existingMember = await prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId: userToInvite.id,
        },
      },
    })
    console.log("Existing member:", existingMember)

    // 4. Check existing invite
    console.log("Checking existing invite...")
    const existingInvite = await prisma.teamInvite.findFirst({
      where: {
        teamId,
        invitedUserId: userToInvite.id,
        status: "PENDING",
      },
    })
    console.log("Existing invite:", existingInvite)

    // 5. Create invite
    console.log("Creating team invite in database...")
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
    console.log("Team invite created:", invite)

    // 6. Invalidate user cache
    console.log("Invalidating user cache...")
    await invalidateUserCache(userToInvite.id)
    console.log("Invalidation complete!")

    console.log("SUCCESS: Simulation finished perfectly!")

  } catch (error) {
    console.error("SIMULATION ERROR:", error)
  }
}

testAddTeamMember().then(() => prisma.$disconnect())
