import { Router } from "express"

import { requireAuth } from "../middleware/requireAuth"
import {
  createApiKeyRecord,
  deleteApiKeyRecord,
  listApiKeys,
  revokeApiKeyRecord,
  updateApiKeyFormFields,
} from "../controllers/apiKey.controller"

const apiKeyRoutes = Router()

apiKeyRoutes.use(requireAuth)
apiKeyRoutes.get("/", listApiKeys)
apiKeyRoutes.post("/", createApiKeyRecord)
apiKeyRoutes.patch("/:apiKeyId/form-fields", updateApiKeyFormFields)
apiKeyRoutes.post("/:apiKeyId/revoke", revokeApiKeyRecord)
apiKeyRoutes.delete("/:apiKeyId", deleteApiKeyRecord)

export default apiKeyRoutes
