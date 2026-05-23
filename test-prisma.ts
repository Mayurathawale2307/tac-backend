import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://neondb_owner:npg_lwerkidF93Bh@ep-polished-moon-aoj3jlwu.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
    }
  }
})

async function main() {
  const count = await prisma.user.count()
  console.log("Count:", count)
}

main().catch(console.error).finally(() => prisma.$disconnect())
