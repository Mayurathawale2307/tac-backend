import crypto from "node:crypto";

import type { Request, Response } from "express";

import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { getCachedOrFetch } from "../lib/redis";
import {
  authUserSelect,
  buildGoogleAuthorizationUrl,
  exchangeGoogleCodeForTokens,
  fetchGoogleProfile,
  ProfileUpdateError,
  updateUserProfile,
  upsertGoogleUser,
} from "../services/auth.service";
import { clearCookie, parseCookies, serializeCookie } from "../utils/cookies";
import {
  createSessionToken,
  verifySessionToken,
  createOAuthStateToken,
  verifyOAuthStateToken,
} from "../utils/session";
import { removeUploadedFiles } from "../utils/uploads";

const SESSION_COOKIE = "tac_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function getCookieSecurityOptions() {
  return {
    httpOnly: true,
    sameSite: env.backendUrl.startsWith("https://") ? "None" : "Lax",
    secure: env.backendUrl.startsWith("https://"),
  } as const;
}

function normalizeOrigin(origin: string) {
  return origin.replace(/\/+$/, "");
}

function getAllowedFrontendOrigin(origin?: string) {
  if (!origin) {
    return null;
  }

  try {
    const normalizedOrigin = normalizeOrigin(new URL(origin).origin);

    if (env.allowedFrontendOrigins.includes(normalizedOrigin)) {
      return normalizedOrigin;
    }
  } catch {
    return null;
  }

  return null;
}

function getRequestFrontendOrigin(req: Request) {
  const frontendOriginQuery =
    typeof req.query.frontend_origin === "string"
      ? req.query.frontend_origin
      : undefined;
  const refererOrigin =
    typeof req.headers.referer === "string"
      ? getAllowedFrontendOrigin(req.headers.referer)
      : null;

  return (
    getAllowedFrontendOrigin(frontendOriginQuery) ??
    getAllowedFrontendOrigin(req.headers.origin) ??
    refererOrigin ??
    env.frontendUrl
  );
}

function buildFrontendRedirect(
  frontendOrigin: string,
  pathname: string,
  params?: Record<string, string>,
) {
  const url = new URL(pathname, frontendOrigin);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

async function startGoogleAuth(req: Request, res: Response) {
  const state = crypto.randomBytes(24).toString("hex");
  const frontendOrigin = getRequestFrontendOrigin(req);
  const stateToken = createOAuthStateToken(state, frontendOrigin);

  res.redirect(buildGoogleAuthorizationUrl(stateToken));
}

async function handleGoogleCallback(req: Request, res: Response) {
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  const state =
    typeof req.query.state === "string" ? req.query.state : undefined;
  const verifiedState = verifyOAuthStateToken(state);
  const frontendOrigin = verifiedState?.frontendOrigin ?? env.frontendUrl;
  const cookieSecurityOptions = getCookieSecurityOptions();

  if (!code || !state || !verifiedState) {
    res.redirect(
      buildFrontendRedirect(frontendOrigin, "/login", {
        error: "google_oauth_state_mismatch",
      }),
    );
    return;
  }

  try {
    const tokens = await exchangeGoogleCodeForTokens(code);
    const profile = await fetchGoogleProfile(tokens.access_token);
    const user = await upsertGoogleUser(profile);

    const sessionToken = createSessionToken({
      email: user.email,
      exp: Date.now() + SESSION_TTL_SECONDS * 1000,
      userId: user.id,
    });

    res.append(
      "Set-Cookie",
      serializeCookie(SESSION_COOKIE, sessionToken, {
        ...cookieSecurityOptions,
        maxAge: SESSION_TTL_SECONDS,
      }),
    );

    res.redirect(
      buildFrontendRedirect(frontendOrigin, "/dashboard", {
        auth: "success",
      }),
    );
  } catch (error) {
    console.error(error);
    res.redirect(
      buildFrontendRedirect(frontendOrigin, "/login", {
        error: "google_oauth_failed",
      }),
    );
  }
}

async function getCurrentUser(req: Request, res: Response) {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySessionToken(cookies[SESSION_COOKIE]);

  if (!session) {
    res.status(401).json({ user: null });
    return;
  }

  const user = await getCachedOrFetch(
    `user:profile:${session.userId}`,
    3600,
    () =>
      prisma.user.findUnique({
        select: authUserSelect,
        where: {
          id: session.userId,
        },
      }),
  );

  if (!user) {
    res.append(
      "Set-Cookie",
      clearCookie(SESSION_COOKIE, {
        ...getCookieSecurityOptions(),
      }),
    );
    res.status(401).json({ user: null });
    return;
  }

  res.json({ user });
}

async function updateProfile(req: Request, res: Response) {
  const requestWithFile = req as Request & { file?: Express.Multer.File };
  const uploadedFile = requestWithFile.file;

  try {
    const user = await updateUserProfile({
      bio: typeof req.body.bio === "string" ? req.body.bio : "",
      company: typeof req.body.company === "string" ? req.body.company : "",
      name: typeof req.body.name === "string" ? req.body.name : "",
      pictureFile: uploadedFile,
      removePicture: req.body.removePicture === "true",
      userId: req.auth!.userId,
      username: typeof req.body.username === "string" ? req.body.username : "",
      website: typeof req.body.website === "string" ? req.body.website : "",
    });

    res.json({ user });
  } catch (error) {
    if (uploadedFile) {
      await removeUploadedFiles([uploadedFile]);
    }

    if (error instanceof ProfileUpdateError) {
      res.status(error.statusCode).json({ message: error.message });
      return;
    }

    throw error;
  }
}

async function logout(_req: Request, res: Response) {
  res.setHeader(
    "Set-Cookie",
    clearCookie(SESSION_COOKIE, {
      ...getCookieSecurityOptions(),
    }),
  );

  res.status(204).send();
}

export {
  getCurrentUser,
  handleGoogleCallback,
  logout,
  startGoogleAuth,
  updateProfile,
};
