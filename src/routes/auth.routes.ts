import { Router } from "express"

import {
  getCurrentUser,
  handleGoogleCallback,
  logout,
  startGoogleAuth,
  updateProfile,
} from "../controllers/auth.controller"
import { requireAuth } from "../middleware/requireAuth"
import { upload } from "../utils/uploads"

const authRoutes = Router()

authRoutes.get("/google", startGoogleAuth)
authRoutes.get("/google/callback", handleGoogleCallback)
authRoutes.get("/me", getCurrentUser)
authRoutes.patch("/profile", requireAuth, upload.single("picture"), updateProfile)
authRoutes.post("/logout", logout)

export default authRoutes
