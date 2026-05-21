import { Router } from "express"

import { requireAuth } from "../middleware/requireAuth"
import { listOperations } from "../controllers/operation.controller"

const operationRoutes = Router()

operationRoutes.use(requireAuth)
operationRoutes.get("/", listOperations)

export default operationRoutes
