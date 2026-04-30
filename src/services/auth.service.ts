import { prisma } from "../lib/prisma"
import { env } from "../config/env"

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

async function upsertGoogleUser(profile: GoogleProfile) {
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ googleId: profile.sub }, { email: profile.email }],
    },
  })

  if (existingUser) {
    return prisma.user.update({
      data: {
        email: profile.email,
        emailVerified: profile.email_verified,
        familyName: profile.family_name,
        givenName: profile.given_name,
        googleId: profile.sub,
        name: profile.name,
        picture: profile.picture,
      },
      where: {
        id: existingUser.id,
      },
      select: {
        id: true,
        email: true,
        name: true,
        picture: true,
        emailVerified: true,
        provider: true,
        createdAt: true,
      },
    })
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
    },
    select: {
      id: true,
      email: true,
      name: true,
      picture: true,
      emailVerified: true,
      provider: true,
      createdAt: true,
    },
  })
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
  buildGoogleAuthorizationUrl,
  exchangeGoogleCodeForTokens,
  fetchGoogleProfile,
  upsertGoogleUser,
}
