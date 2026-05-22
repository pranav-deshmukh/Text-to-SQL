import jwt from "jsonwebtoken";
import { AuthenticatedUser } from "./types";

interface TokenPayload {
  sub: string;
  username: string;
  role: AuthenticatedUser["role"];
}

const DEFAULT_EXPIRY_SECONDS = 60 * 60 * 8; // 8 hours

function getSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.length === 0) {
    throw new Error(
      "FATAL: JWT_SECRET environment variable is not set. " +
        "The application cannot start without a secure signing secret. " +
        "Set JWT_SECRET in your .env file or environment variables."
    );
  }
  if (secret.length < 32) {
    throw new Error(
      "FATAL: JWT_SECRET must be at least 32 characters long for adequate security."
    );
  }
  return secret;
}

function getExpirySeconds(): number {
  const raw = Number.parseInt(process.env.JWT_EXPIRY_SECONDS || "", 10);
  if (Number.isInteger(raw) && raw > 0) {
    return raw;
  }
  return DEFAULT_EXPIRY_SECONDS;
}

// Lazily resolved on first use (after dotenv has loaded in index.ts)
let _secret: string | null = null;

function resolveSecret(): string {
  if (!_secret) {
    _secret = getSecret(); // throws if missing/short
  }
  return _secret;
}

export function createAuthToken(user: AuthenticatedUser): string {
  const payload: TokenPayload = {
    sub: user.userId,
    username: user.username,
    role: user.role,
  };

  return jwt.sign(payload, resolveSecret(), {
    expiresIn: getExpirySeconds(),
    algorithm: "HS256",
  });
}

export function verifyAuthToken(token: string): AuthenticatedUser | null {
  try {
    const decoded = jwt.verify(token, resolveSecret(), {
      algorithms: ["HS256"],
    }) as unknown as jwt.JwtPayload & TokenPayload;

    if (!decoded.sub || !decoded.username || !decoded.role) {
      return null;
    }

    return {
      userId: decoded.sub,
      username: decoded.username,
      role: decoded.role,
    };
  } catch {
    return null;
  }
}
