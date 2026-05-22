import crypto from "node:crypto"

import type { Request, Response } from "express"

import { env } from "../config/env"
import { prisma } from "../lib/prisma"
import {
  authUserSelect,
  buildGoogleAuthorizationUrl,
  exchangeGoogleCodeForTokens,
  fetchGoogleProfile,
  ProfileUpdateError,
  updateUserProfile,
  upsertGoogleUser,
} from "../services/auth.service"
import { clearCookie, parseCookies, serializeCookie } from "../utils/cookies"
import { createSessionToken, verifySessionToken } from "../utils/session"
import { removeUploadedFiles } from "../utils/uploads"

const OAUTH_STATE_COOKIE = "tac_google_oauth_state"
const SESSION_COOKIE = "tac_session"
const OAUTH_STATE_TTL_SECONDS = 60 * 10
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

function buildFrontendRedirect(pathname: string, params?: Record<string, string>) {
  const url = new URL(pathname, env.frontendUrl)

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
  }

  return url.toString()
}

async function startGoogleAuth(_req: Request, res: Response) {
  const state = crypto.randomBytes(24).toString("hex")

  res.setHeader(
    "Set-Cookie",
    serializeCookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      maxAge: OAUTH_STATE_TTL_SECONDS,
      secure: env.isProduction,
    })
  )

  res.redirect(buildGoogleAuthorizationUrl(state))
}

async function handleGoogleCallback(req: Request, res: Response) {
  const code = typeof req.query.code === "string" ? req.query.code : undefined
  const state = typeof req.query.state === "string" ? req.query.state : undefined
  const cookies = parseCookies(req.headers.cookie)
  const storedState = cookies[OAUTH_STATE_COOKIE]

  res.append(
    "Set-Cookie",
    clearCookie(OAUTH_STATE_COOKIE, {
      httpOnly: true,
      secure: env.isProduction,
    })
  )

  if (!code || !state || !storedState || state !== storedState) {
    res.redirect(
      buildFrontendRedirect("/login", {
        error: "google_oauth_state_mismatch",
      })
    )
    return
  }

  try {
    const tokens = await exchangeGoogleCodeForTokens(code)
    const profile = await fetchGoogleProfile(tokens.access_token)
    const user = await upsertGoogleUser(profile)

    const sessionToken = createSessionToken({
      email: user.email,
      exp: Date.now() + SESSION_TTL_SECONDS * 1000,
      userId: user.id,
    })

    res.append(
      "Set-Cookie",
      serializeCookie(SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        maxAge: SESSION_TTL_SECONDS,
        secure: env.isProduction,
      })
    )

    res.redirect(buildFrontendRedirect("/dashboard", { auth: "success" }))
  } catch (error) {
    console.error(error)
    res.redirect(
      buildFrontendRedirect("/login", {
        error: "google_oauth_failed",
      })
    )
  }
}

async function getCurrentUser(req: Request, res: Response) {
  const cookies = parseCookies(req.headers.cookie)
  const session = verifySessionToken(cookies[SESSION_COOKIE])

  if (!session) {
    res.status(401).json({ user: null })
    return
  }

  const user = await prisma.user.findUnique({
    select: authUserSelect,
    where: {
      id: session.userId,
    },
  })

  if (!user) {
    res.append(
      "Set-Cookie",
      clearCookie(SESSION_COOKIE, {
        httpOnly: true,
        secure: env.isProduction,
      })
    )
    res.status(401).json({ user: null })
    return
  }

  res.json({ user })
}

async function updateProfile(req: Request, res: Response) {
  const requestWithFile = req as Request & { file?: Express.Multer.File }
  const uploadedFile = requestWithFile.file

  try {
    const user = await updateUserProfile({
      bio: typeof req.body.bio === "string" ? req.body.bio : "",
      company: typeof req.body.company === "string" ? req.body.company : "",
      name: typeof req.body.name === "string" ? req.body.name : "",
      pictureFile: uploadedFile,
      removePicture: req.body.removePicture === "true",
      userId: req.auth!.userId,
      username: typeof req.body.username === "string" ? req.body.username : "",
      website: typeof req.body.website === "string" ? req.body.website : "",
    })

    res.json({ user })
  } catch (error) {
    if (uploadedFile) {
      await removeUploadedFiles([uploadedFile])
    }

    if (error instanceof ProfileUpdateError) {
      res.status(error.statusCode).json({ message: error.message })
      return
    }

    throw error
  }
}

async function logout(_req: Request, res: Response) {
  res.setHeader(
    "Set-Cookie",
    clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      secure: env.isProduction,
    })
  )

  res.status(204).send()
}

export {
  getCurrentUser,
  handleGoogleCallback,
  logout,
  startGoogleAuth,
  updateProfile,
}
