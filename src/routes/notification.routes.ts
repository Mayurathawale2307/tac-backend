import { Router } from "express"

import {
  listUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../controllers/notification.controller"
import { requireAuth } from "../middleware/requireAuth"

const notificationRoutes = Router()

notificationRoutes.use(requireAuth)

notificationRoutes.get("/", listUserNotifications)
notificationRoutes.post("/read-all", markAllNotificationsRead)
notificationRoutes.post("/:notificationId/read", markNotificationRead)

export default notificationRoutes
