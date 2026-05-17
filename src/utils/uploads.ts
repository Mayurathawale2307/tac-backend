import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import multer from "multer"

import { env } from "../config/env"

const uploadsDirectory = path.resolve(process.cwd(), "uploads")

function ensureUploadsDirectory() {
  fs.mkdirSync(uploadsDirectory, { recursive: true })
}

function buildUploadUrl(filename: string) {
  return `${env.backendUrl}/uploads/${filename}`
}

async function removeUploadedFiles(files: Express.Multer.File[]) {
  await Promise.all(
    files.map((file) =>
      fs.promises.unlink(file.path).catch(() => undefined)
    )
  )
}

const upload = multer({
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 6,
  },
  storage: multer.diskStorage({
    destination(_req, _file, callback) {
      ensureUploadsDirectory()
      callback(null, uploadsDirectory)
    },
    filename(_req, file, callback) {
      const extension = path.extname(file.originalname)
      callback(null, `${crypto.randomUUID()}${extension}`)
    },
  }),
})

export { buildUploadUrl, ensureUploadsDirectory, removeUploadedFiles, upload, uploadsDirectory }
