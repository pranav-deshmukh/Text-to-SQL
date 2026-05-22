import bcrypt from "bcrypt";
import { AuthUserRecord, UserRole } from "./types";

const SALT_ROUNDS = 12;

interface UserConfig {
  userId: string;
  username: string;
  passwordHash: string;
  role: UserRole;
}

/**
 * Password resolution strategy:
 *   1. If *_PASSWORD_HASH env var is set (bcrypt format), use it directly.
 *   2. Otherwise, hash *_PASSWORD (or default) at startup. This is for dev only.
 *
 * For production: pre-generate bcrypt hashes and set *_PASSWORD_HASH env vars.
 */
function resolvePasswordHash(hashEnv: string | undefined, plainEnv: string | undefined, fallbackPlain: string): string {
  const preHashed = hashEnv?.trim();
  if (preHashed && preHashed.startsWith("$2")) {
    return preHashed;
  }

  const plain = plainEnv?.trim() || fallbackPlain;
  console.warn(
    `[AUTH] No pre-hashed password found (expected *_PASSWORD_HASH env var). ` +
      `Hashing plaintext at startup. For production, pre-generate bcrypt hashes.`
  );
  return bcrypt.hashSync(plain, SALT_ROUNDS);
}

const USERS: UserConfig[] = [
  {
    userId: "end-user-demo",
    username: (process.env.END_USER_USERNAME?.trim() || "enduser").toLowerCase(),
    passwordHash: resolvePasswordHash(
      process.env.END_USER_PASSWORD_HASH,
      process.env.END_USER_PASSWORD,
      "EndUser@123"
    ),
    role: "end_user",
  },
  {
    userId: "tech-team-demo",
    username: (process.env.TECH_TEAM_USERNAME?.trim() || "techteam").toLowerCase(),
    passwordHash: resolvePasswordHash(
      process.env.TECH_TEAM_PASSWORD_HASH,
      process.env.TECH_TEAM_PASSWORD,
      "TechTeam@123"
    ),
    role: "tech_team",
  },
];

function toSafeUser(user: UserConfig): Omit<AuthUserRecord, "password"> {
  return {
    userId: user.userId,
    username: user.username,
    role: user.role,
  };
}

export function authenticateUser(username: string, password: string) {
  const normalizedUsername = username.trim().toLowerCase();
  const user = USERS.find((u) => u.username === normalizedUsername);

  if (!user) {
    // Constant-time: hash anyway to prevent timing-based user enumeration
    bcrypt.compareSync(password, "$2b$12$000000000000000000000uGTWDOF/JQPIBxMOqMjV5mtK9JahXm");
    return null;
  }

  const isValid = bcrypt.compareSync(password, user.passwordHash);
  if (!isValid) {
    return null;
  }

  return toSafeUser(user);
}

export function findUserById(userId: string) {
  const user = USERS.find((u) => u.userId === userId);
  return user ? toSafeUser(user) : null;
}
