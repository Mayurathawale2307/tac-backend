import type { NextFunction, Request, Response } from "express"

import { parseCookies } from "../utils/cookies"
import { verifySessionToken } from "../utils/session"

const SESSION_COOKIE = "tac_session"

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie)
  const session = verifySessionToken(cookies[SESSION_COOKIE])

  if (!session) {
    res.status(401).json({ message: "Unauthorized" })
    return
  }

  req.auth = {
    email: session.email,
    userId: session.userId,
  }

  next()
}

export { requireAuth }
