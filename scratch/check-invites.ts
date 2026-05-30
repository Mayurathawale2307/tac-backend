import { PrismaClient } from "@prisma/client"
const prisma = new PrismaClient()

async function main() {
  console.log("--- Users ---")
  const users = await prisma.user.findMany({
    select: { id: true, email: true, username: true, name: true }
  })
  console.log(users)

  console.log("--- Teams ---")
  const teams = await prisma.team.findMany({
    select: { id: true, name: true }
  })
  console.log(teams)

  console.log("--- Team Members ---")
  const members = await prisma.teamMember.findMany({
    include: {
      team: { select: { name: true } },
      user: { select: { username: true } }
    }
  })
  console.log(members.map(m => ({
    team: m.team.name,
    username: m.user.username,
    role: m.role
  })))

  console.log("--- Team Invites ---")
  const invites = await prisma.teamInvite.findMany({
    include: {
      team: { select: { name: true } },
      invitedUser: { select: { username: true } }
    }
  })
  console.log(invites.map(i => ({
    id: i.id,
    team: i.team.name,
    invitedUser: i.invitedUser.username,
    status: i.status
  })))
}

main().catch(console.error).finally(() => prisma.$disconnect())
