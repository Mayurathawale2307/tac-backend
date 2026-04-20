import { Router } from "express"

import {
  getCurrentUser,
  handleGoogleCallback,
  logout,
  startGoogleAuth,
} from "../controllers/auth.controller"

const authRoutes = Router()

authRoutes.get("/google", startGoogleAuth)
authRoutes.get("/google/callback", handleGoogleCallback)
authRoutes.get("/me", getCurrentUser)
authRoutes.post("/logout", logout)

export default authRoutes
