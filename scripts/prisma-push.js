const path = require('node:path')
const fs = require('node:fs')
const { execSync } = require('node:child_process')
const dotenv = require('dotenv')

const cwd = process.cwd()
const envFiles = [
  '.env.local',
  '.env',
]

const envPath = envFiles
  .map((file) => path.resolve(cwd, file))
  .find((file) => fs.existsSync(file))

if (!envPath) {
  console.error('No .env file found. Please create .env or .env.local.')
  process.exit(1)
}

console.log(`Loading environment from ${envPath}`)
dotenv.config({ path: envPath, override: true })

try {
  execSync('npx prisma db push --schema=prisma/schema.prisma', {
    stdio: 'inherit',
    env: process.env,
    shell: true,
  })
} catch (error) {
  process.exit(error.status || 1)
}
