import "./src/config/env"
import { PrismaClient } from "@prisma/client"
// Import the built TACClient from the SDK package dist
import { TACClient } from "../tac-package/tac-sdk/src/client"
import { generateApiKey } from "./src/utils/apiKey"

const prisma = new PrismaClient()

async function runTest() {
  console.log("Starting verification test...")

  // 1. Find or create a User
  let user = await prisma.user.findFirst()
  if (!user) {
    console.log("No user found in database. Creating a temporary dummy user...")
    user = await prisma.user.create({
      data: {
        googleId: "dummy_google_id_" + Date.now(),
        email: "dummy_user_" + Date.now() + "@example.com",
        name: "Test User",
        provider: "google",
      },
    })
  }

  // 2. Find or create an active ApiKey
  let apiKeyRecord = await prisma.apiKey.findFirst({
    where: { status: "ACTIVE" },
  })

  let rawKey = ""
  if (!apiKeyRecord) {
    console.log("No active API Key found in database. Creating a new one...")
    const generated = generateApiKey("DEVELOPMENT")
    rawKey = generated.fullKey
    apiKeyRecord = await prisma.apiKey.create({
      data: {
        userId: user.id,
        name: "Local Test Key",
        environment: "DEVELOPMENT",
        prefix: generated.prefix,
        lastFour: generated.lastFour,
        keyHash: generated.keyHash,
        status: "ACTIVE",
      },
    })
  } else {
    console.log("Found existing active API key. Generating a temp key for test since we cannot read keyHash in cleartext...")
    const generated = generateApiKey("DEVELOPMENT")
    rawKey = generated.fullKey
    apiKeyRecord = await prisma.apiKey.create({
      data: {
        userId: user.id,
        name: "Temp Test Key",
        environment: "DEVELOPMENT",
        prefix: generated.prefix,
        lastFour: generated.lastFour,
        keyHash: generated.keyHash,
        status: "ACTIVE",
      },
    })
  }

  console.log(`Using API Key: ${rawKey} (Hash: ${apiKeyRecord.keyHash})`)

  // 3. Initialize TACClient from our built SDK pointing to our local backend
  const client = new TACClient({
    apiKey: rawKey,
    baseUrl: "http://localhost:4000",
  })

  // 4. Send a test message using the SDK
  console.log("Sending message via SDK capture...")
  const testPayload = {
    name: "John Doe",
    email: "john.doe@example.com",
    message: "Hello Antigravity! This is an end-to-end integration test of the public messages route.",
  }

  try {
    const response = await client.capture(testPayload)
    console.log("SDK capture response:", response)

    // 5. Verify database record
    console.log("Verifying database record...")
    const dbMessage = await prisma.message.findFirst({
      where: {
        apiKeyId: apiKeyRecord.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    })

    if (!dbMessage) {
      throw new Error("FAIL: Message not found in database!")
    }

    console.log("Found message in database:", dbMessage)
    if (dbMessage.sender === testPayload.name && dbMessage.email === testPayload.email && dbMessage.message === testPayload.message) {
      console.log("SUCCESS: Message matches expected values!")
    } else {
      throw new Error(`FAIL: Message details do not match! Expected name ${testPayload.name}, email ${testPayload.email}, but got ${dbMessage.sender}, ${dbMessage.email}`)
    }

  } catch (error) {
    console.error("Test failed with error:", error)
    process.exit(1)
  } finally {
    // Clean up the temp API key we created for this run
    console.log("Cleaning up temporary test API key...")
    await prisma.apiKey.delete({
      where: { id: apiKeyRecord.id },
    })
    await prisma.$disconnect()
  }
}

runTest().catch((err) => {
  console.error(err)
  process.exit(1)
})
