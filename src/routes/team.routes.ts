import { Router } from "express"
import {
  createTeam,
  createTeamNotification,
  listUserTeams,
  getTeam,
  addTeamMember,
  listTeamNotifications,
  removeTeamMember,
  getTeamMessages,
  updateTeam,
  createTeamApiKey,
} from "../controllers/team.controller"
import { requireAuth } from "../middleware/requireAuth"

const teamRoutes = Router()

// Apply auth middleware to all routes
teamRoutes.use(requireAuth)

// Team CRUD
teamRoutes.post("/", createTeam)
teamRoutes.get("/", listUserTeams)
teamRoutes.get("/:teamId", getTeam)
teamRoutes.patch("/:teamId", updateTeam)
teamRoutes.post("/:teamId/api-keys", createTeamApiKey)
teamRoutes.get("/:teamId/notifications", listTeamNotifications)
teamRoutes.post("/:teamId/notifications", createTeamNotification)

// Team members
teamRoutes.post("/:teamId/members", addTeamMember)
teamRoutes.delete("/:teamId/members/:memberId", removeTeamMember)

// Team messages
teamRoutes.get("/:teamId/messages", getTeamMessages)

export default teamRoutes
