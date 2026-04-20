type SameSite = "Lax" | "Strict" | "None"

type CookieOptions = {
  httpOnly?: boolean
  maxAge?: number
  path?: string
  sameSite?: SameSite
  secure?: boolean
}

function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {}
) {
  const segments = [`${name}=${encodeURIComponent(value)}`]

  if (typeof options.maxAge === "number") {
    segments.push(`Max-Age=${Math.floor(options.maxAge)}`)
  }

  segments.push(`Path=${options.path ?? "/"}`)
  segments.push(`SameSite=${options.sameSite ?? "Lax"}`)

  if (options.httpOnly) {
    segments.push("HttpOnly")
  }

  if (options.secure) {
    segments.push("Secure")
  }

  return segments.join("; ")
}

function clearCookie(name: string, options: CookieOptions = {}) {
  return serializeCookie(name, "", {
    ...options,
    maxAge: 0,
  })
}

function parseCookies(cookieHeader?: string) {
  if (!cookieHeader) {
    return {} as Record<string, string>
  }

  return cookieHeader.split(";").reduce<Record<string, string>>((acc, cookie) => {
    const [rawName, ...rawValueParts] = cookie.trim().split("=")

    if (!rawName) {
      return acc
    }

    acc[rawName] = decodeURIComponent(rawValueParts.join("="))
    return acc
  }, {})
}

export { clearCookie, parseCookies, serializeCookie }
