import { prisma } from "../lib/prisma"
import { env } from "../config/env"
import { buildUploadUrl, removeUploadedFileByUrl } from "../utils/uploads"
import { invalidateUserCache } from "../lib/redis"

type GoogleTokenResponse = {
  access_token: string
  expires_in: number
  id_token?: string
  scope: string
  token_type: "Bearer"
}

type GoogleProfile = {
  email: string
  email_verified: boolean
  family_name?: string
  given_name?: string
  name?: string
  picture?: string
  sub: string
}

const authUserSelect = {
  bio: true,
  company: true,
  createdAt: true,
  email: true,
  emailVerified: true,
  id: true,
  name: true,
  picture: true,
  provider: true,
  username: true,
  website: true,
} as const

class ProfileUpdateError extends Error {
  statusCode: number

  constructor(message: string, statusCode: number = 400) {
    super(message)
    this.name = "ProfileUpdateError"
    this.statusCode = statusCode
  }
}

async function exchangeGoogleCodeForTokens(code: string) {
  const body = new URLSearchParams({
    client_id: env.googleClientId,
    client_secret: env.googleClientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: env.googleCallbackUrl,
  })

  const response = await fetch("https://oauth2.googleapis.com/token", {
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Google token exchange failed: ${errorText}`)
  }

  return (await response.json()) as GoogleTokenResponse
}

async function fetchGoogleProfile(accessToken: string) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Google profile request failed: ${errorText}`)
  }

  return (await response.json()) as GoogleProfile
}

function normalizeUsername(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")

  return normalized || "user"
}

async function ensureUniqueUsername(baseValue: string) {
  let username = normalizeUsername(baseValue)
  let candidate = username
  let suffix = 1

  while (
    await prisma.user.findUnique({
      where: {
        username: candidate,
      },
    })
  ) {
    candidate = `${username}${suffix}`
    suffix += 1
  }

  return candidate
}

async function upsertGoogleUser(profile: GoogleProfile) {
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ googleId: profile.sub }, { email: profile.email }],
    },
  })

  if (existingUser) {
    const username = existingUser.username ?? await ensureUniqueUsername(profile.email.split("@")[0] ?? profile.email)

    const updatedUser = await prisma.user.update({
      data: {
        email: profile.email,
        emailVerified: profile.email_verified,
        familyName: profile.family_name,
        givenName: profile.given_name,
        googleId: profile.sub,
        username,
      },
      where: {
        id: existingUser.id,
      },
      select: authUserSelect,
    })

    await invalidateUserCache(existingUser.id)
    return updatedUser
  }

  return prisma.user.create({
    data: {
      email: profile.email,
      emailVerified: profile.email_verified,
      familyName: profile.family_name,
      givenName: profile.given_name,
      googleId: profile.sub,
      name: profile.name,
      picture: profile.picture,
      provider: "google",
      username: await ensureUniqueUsername(profile.email.split("@")[0] ?? profile.email),
    },
    select: authUserSelect,
  })
}

function normalizeOptionalValue(value: string, maxLength: number) {
  const normalized = value.trim()

  if (!normalized) {
    return null
  }

  return normalized.slice(0, maxLength)
}

function normalizeWebsite(value: string) {
  const normalized = value.trim()

  if (!normalized) {
    return null
  }

  const withProtocol = /^https?:\/\//i.test(normalized)
    ? normalized
    : `https://${normalized}`

  let url: URL

  try {
    url = new URL(withProtocol)
  } catch {
    throw new ProfileUpdateError("Enter a valid website URL.")
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new ProfileUpdateError("Website URLs must use http or https.")
  }

  return url.toString()
}

async function resolveProfileUsername(userId: string, value: string) {
  if (!value.trim()) {
    throw new ProfileUpdateError("Username is required.")
  }

  const normalized = normalizeUsername(value)

  if (normalized.length < 3) {
    throw new ProfileUpdateError("Username must be at least 3 characters long.")
  }

  if (normalized.length > 24) {
    throw new ProfileUpdateError("Username must be 24 characters or fewer.")
  }

  const existingUser = await prisma.user.findUnique({
    select: {
      id: true,
    },
    where: {
      username: normalized,
    },
  })

  if (existingUser && existingUser.id !== userId) {
    throw new ProfileUpdateError("That username is already taken.", 409)
  }

  return normalized
}

async function updateUserProfile(input: {
  bio: string
  company: string
  name: string
  pictureFile?: Express.Multer.File
  removePicture: boolean
  userId: string
  username: string
  website: string
}) {
  const existingUser = await prisma.user.findUnique({
    select: {
      id: true,
      picture: true,
    },
    where: {
      id: input.userId,
    },
  })

  if (!existingUser) {
    throw new ProfileUpdateError("User not found.", 404)
  }

  const username = await resolveProfileUsername(input.userId, input.username)
  const name = normalizeOptionalValue(input.name, 80)
  const company = normalizeOptionalValue(input.company, 80)
  const bio = normalizeOptionalValue(input.bio, 280)
  const website = normalizeWebsite(input.website)
  const nextPicture = input.pictureFile
    ? buildUploadUrl(input.pictureFile.filename)
    : input.removePicture
      ? null
      : existingUser.picture

  const user = await prisma.user.update({
    data: {
      bio,
      company,
      name,
      picture: nextPicture,
      username,
      website,
    },
    select: authUserSelect,
    where: {
      id: input.userId,
    },
  })

  await invalidateUserCache(input.userId)

  if (existingUser.picture && existingUser.picture !== nextPicture) {
    await removeUploadedFileByUrl(existingUser.picture)
  }

  return user
}

function buildGoogleAuthorizationUrl(state: string) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")

  url.searchParams.set("client_id", env.googleClientId)
  url.searchParams.set("redirect_uri", env.googleCallbackUrl)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", "openid email profile")
  url.searchParams.set("state", state)
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "select_account")

  return url.toString()
}

export {
  authUserSelect,
  buildGoogleAuthorizationUrl,
  exchangeGoogleCodeForTokens,
  fetchGoogleProfile,
  ProfileUpdateError,
  updateUserProfile,
  upsertGoogleUser,
}
