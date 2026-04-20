declare module "cors" {
  import type { RequestHandler } from "express"

  type CorsOriginCallback = (error: Error | null, allow?: boolean) => void

  type CorsOptions = {
    credentials?: boolean
    origin?: (origin: string | undefined, callback: CorsOriginCallback) => void
  }

  function cors(options?: CorsOptions): RequestHandler

  export default cors
}
