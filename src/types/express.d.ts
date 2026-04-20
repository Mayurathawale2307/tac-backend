declare global {
  namespace Express {
    interface Request {
      auth?: {
        email: string
        userId: string
      }
    }
  }
}

export {}
