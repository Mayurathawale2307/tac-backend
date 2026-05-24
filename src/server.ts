import cors from "cors"
import path from "node:path"
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express"

import { env } from "./config/env"
import authRoutes from "./routes/auth.routes"
import apiKeyRoutes from "./routes/apiKey.routes"
import inviteRoutes from "./routes/invite.routes"
import messageRoutes from "./routes/message.routes"
import notificationRoutes from "./routes/notification.routes"
import operationRoutes from "./routes/operation.routes"
import teamRoutes from "./routes/team.routes"
import { submitMessage } from "./controllers/message.controller"
import { upload, uploadsDirectory } from "./utils/uploads"

const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use("/uploads", express.static(path.resolve(uploadsDirectory)))

app.options("/api/messages", cors())
app.post("/api/messages", cors(), upload.any(), submitMessage)

app.use(
  cors({
    credentials: true,
    origin(
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void
    ) {
      const normalizedOrigin = origin?.replace(/\/+$/, "")

      if (
        !normalizedOrigin ||
        env.allowedFrontendOrigins.includes(normalizedOrigin)
      ) {
        callback(null, true)
        return
      }

      callback(new Error("Origin not allowed by CORS"))
    },
  })
)

app.get("/health", (_req, res) => {
  res.json({ status: "ok" })
})

app.use("/api/auth", authRoutes)
app.use("/api/api-keys", apiKeyRoutes)
app.use("/api/invites", inviteRoutes)
app.use("/api/messages", messageRoutes)
app.use("/api/notifications", notificationRoutes)
app.use("/api/operations", operationRoutes)
app.use("/api/teams", teamRoutes)

app.use((_req, res) => {
  res.status(404).json({ message: "Route not found" })
})

app.use(
  (
    error: Error,
    _req: Request,
    res: Response,
    _next: NextFunction
  ) => {
    console.error(error)
    res.status(500).json({ message: "Internal server error" })
  }
)

export { app }
