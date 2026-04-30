import { Router } from "express"
import {
  createTeam,
  listUserTeams,
  getTeam,
  addTeamMember,
  removeTeamMember,
  getTeamMessages,
  updateTeam,
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

// Team members
teamRoutes.post("/:teamId/members", addTeamMember)
teamRoutes.delete("/:teamId/members/:memberId", removeTeamMember)

// Team messages
teamRoutes.get("/:teamId/messages", getTeamMessages)

export default teamRoutes
