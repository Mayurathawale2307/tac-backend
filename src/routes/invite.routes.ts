import { Router } from "express"
import { requireAuth } from "../middleware/requireAuth"
import {
  listUserInvites,
  acceptTeamInvite,
} from "../controllers/team.controller"

const inviteRoutes = Router()

inviteRoutes.use(requireAuth)
inviteRoutes.get("/", listUserInvites)
inviteRoutes.post("/:inviteId/accept", acceptTeamInvite)

export default inviteRoutes
