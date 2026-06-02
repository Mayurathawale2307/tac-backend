import crypto from "node:crypto";

import { env } from "../config/env";

type SessionPayload = {
  email: string;
  exp: number;
  userId: string;
};

type OAuthStatePayload = {
  nonce: string;
  frontendOrigin: string;
  exp: number;
};

function sign(value: string) {
  return crypto
    .createHmac("sha256", env.sessionSecret)
    .update(value)
    .digest("base64url");
}

function createSessionToken(payload: SessionPayload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = sign(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

function verifySessionToken(token?: string) {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload);

  if (expectedSignature.length !== signature.length) {
    return null;
  }

  const isValid = crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(signature),
  );

  if (!isValid) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as SessionPayload;

    if (payload.exp <= Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function createOAuthStateToken(nonce: string, frontendOrigin: string) {
  const payload: OAuthStatePayload = {
    nonce,
    frontendOrigin,
    exp: Date.now() + 10 * 60 * 1000,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = sign(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

function verifyOAuthStateToken(token?: string) {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload);

  if (expectedSignature.length !== signature.length) {
    return null;
  }

  const isValid = crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(signature),
  );

  if (!isValid) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as OAuthStatePayload;

    if (payload.exp <= Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export {
  createSessionToken,
  verifySessionToken,
  createOAuthStateToken,
  verifyOAuthStateToken,
};
