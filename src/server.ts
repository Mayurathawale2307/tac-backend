import cors from "cors"
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express"

import { env } from "./config/env"
import authRoutes from "./routes/auth.routes"

const app = express()

app.use(
  cors({
    credentials: true,
    origin(
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void
    ) {
      if (!origin || origin === env.frontendUrl) {
        callback(null, true)
        return
      }

      callback(new Error("Origin not allowed by CORS"))
    },
  })
)

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.get("/health", (_req, res) => {
  res.json({ status: "ok" })
})

app.use("/api/auth", authRoutes)

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
