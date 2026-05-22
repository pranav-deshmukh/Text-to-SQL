import type { NextFunction, Request, Response } from "express";
import { buildRequestError } from "../errors/queryError";
import { verifyAuthToken } from "./token";
import { AuthenticatedUser, UserRole } from "./types";

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

function unauthorized(res: Response, message: string) {
  return res.status(401).json({
    ...buildRequestError(message),
    error: "Authentication required.",
    code: "AUTH_REQUIRED",
  });
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.header("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!token) {
    return unauthorized(res, "Missing bearer token.");
  }

  const user = verifyAuthToken(token);
  if (!user) {
    return unauthorized(res, "Invalid or expired bearer token.");
  }

  req.user = user;
  return next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return unauthorized(res, "Missing authenticated user context.");
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        ...buildRequestError(`Role ${req.user.role} is not allowed to access this route.`),
        error: "You do not have permission to perform this action.",
        code: "FORBIDDEN",
      });
    }

    return next();
  };
}
