import { Router } from "express"

import { listMessageFeeds } from "../controllers/message.controller"
import { requireAuth } from "../middleware/requireAuth"

const messageRoutes = Router()

messageRoutes.get("/", requireAuth, listMessageFeeds)

export default messageRoutes
