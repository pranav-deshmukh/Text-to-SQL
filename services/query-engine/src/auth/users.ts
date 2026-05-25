import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import msnodesqlv8 from "msnodesqlv8";
import { getRegisteredDatabases } from "../config/dbRegistry";
import { AuthUserRecord, UserRole } from "./types";

const USERS_TABLE = "[dbo].[app_users]";
const USERNAME_PATTERN = /^[a-z0-9._@-]{3,128}$/i;
const USER_ID_PATTERN = /^[a-z0-9._:@-]{1,128}$/i;
const DUMMY_BCRYPT_HASH = "$2b$12$DkTFZXWZl8Qaw2SFLjDP/O.OesBJUHron8mlG2YjeOykKFoDfN3zq";
const SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

interface SqlAuthUserRow {
  userId: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean | number | string;
}

export function resolveAuthConnectionString(): string {
  const explicit = process.env.AUTH_DB_CONNECTION_STRING?.trim();
  if (explicit) {
    return explicit;
  }

  const fallback = process.env.DB_CONNECTION_STRING?.trim();
  if (fallback) {
    return fallback;
  }

  const firstRegistered = getRegisteredDatabases()[0]?.connectionString?.trim();
  if (firstRegistered) {
    return firstRegistered;
  }

  throw new Error(
    "No auth database connection is configured. Set AUTH_DB_CONNECTION_STRING or ensure at least one query database is registered."
  );
}

function maskConnectionString(connectionString: string): string {
  return connectionString.replace(/Pwd=[^;]*/i, "Pwd=***");
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function isValidRole(role: string): role is UserRole {
  return role === "end_user" || role === "tech_team";
}

function isActiveFlag(value: SqlAuthUserRow["isActive"]): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  return value === "1" || value.toLowerCase() === "true";
}

function queryRows<T>(connectionString: string, sqlQuery: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    msnodesqlv8.query(connectionString, sqlQuery, (error, rows?: T[]) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows ?? []);
    });
  });
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function validateSignupPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
  }

  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must include uppercase, lowercase, and a number.";
  }

  return null;
}

function toSafeUser(row: SqlAuthUserRow): AuthUserRecord | null {
  const role = typeof row.role === "string" ? row.role : "";
  if (!isValidRole(role)) {
    return null;
  }

  return {
    userId: row.userId,
    username: row.username.trim().toLowerCase(),
    role,
  };
}

async function compareAgainstDummyHash(password: string): Promise<void> {
  await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
}

export async function registerAuthStore(): Promise<void> {
  const connectionString = resolveAuthConnectionString();
  console.log("🔐 Connecting auth store with:", maskConnectionString(connectionString));

  const rows = await queryRows<{ activeUserCount: number }>(
    connectionString,
    `SELECT COUNT(1) AS activeUserCount FROM ${USERS_TABLE} WHERE is_active = 1;`
  );

  console.log(`🔐 Auth store ready with ${rows[0]?.activeUserCount ?? 0} active user(s).`);
}

export async function authenticateUser(username: string, password: string): Promise<AuthUserRecord | null> {
  const normalizedUsername = normalizeUsername(username);
  if (!USERNAME_PATTERN.test(normalizedUsername)) {
    await compareAgainstDummyHash(password);
    return null;
  }

  const connectionString = resolveAuthConnectionString();
  const escapedUsername = escapeSqlLiteral(normalizedUsername);
  const rows = await queryRows<SqlAuthUserRow>(
    connectionString,
    `SELECT TOP 1
        user_id AS userId,
        username,
        password_hash AS passwordHash,
        role,
        is_active AS isActive
      FROM ${USERS_TABLE}
      WHERE username = N'${escapedUsername}';`
  );

  const user = rows[0];
  if (!user || !isActiveFlag(user.isActive)) {
    await compareAgainstDummyHash(password);
    return null;
  }

  const safeUser = toSafeUser(user);
  if (!safeUser) {
    await compareAgainstDummyHash(password);
    return null;
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return null;
  }

  return safeUser;
}

export async function createUser(username: string, password: string): Promise<{ user?: AuthUserRecord; error?: string; code?: string }> {
  const normalizedUsername = normalizeUsername(username);
  if (!USERNAME_PATTERN.test(normalizedUsername)) {
    return {
      error: "Username must be 3-128 characters and may only contain letters, numbers, dot, underscore, dash, or @.",
      code: "AUTH_INVALID_USERNAME",
    };
  }

  const passwordValidationError = validateSignupPassword(password);
  if (passwordValidationError) {
    return {
      error: passwordValidationError,
      code: "AUTH_WEAK_PASSWORD",
    };
  }

  const connectionString = resolveAuthConnectionString();
  const escapedUsername = escapeSqlLiteral(normalizedUsername);
  const existingUsers = await queryRows<SqlAuthUserRow>(
    connectionString,
    `SELECT TOP 1
        user_id AS userId,
        username,
        password_hash AS passwordHash,
        role,
        is_active AS isActive
      FROM ${USERS_TABLE}
      WHERE username = N'${escapedUsername}';`
  );

  if (existingUsers.length > 0) {
    return {
      error: "Username already exists.",
      code: "AUTH_USERNAME_EXISTS",
    };
  }

  const userId = `user-${randomUUID()}`;
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const escapedUserId = escapeSqlLiteral(userId);
  const escapedPasswordHash = escapeSqlLiteral(passwordHash);

  await queryRows(
    connectionString,
    `INSERT INTO ${USERS_TABLE} (user_id, username, password_hash, role, is_active)
      VALUES (
        N'${escapedUserId}',
        N'${escapedUsername}',
        N'${escapedPasswordHash}',
        N'end_user',
        1
      );`
  );

  return {
    user: {
      userId,
      username: normalizedUsername,
      role: "end_user",
    },
  };
}

export async function findUserById(userId: string): Promise<AuthUserRecord | null> {
  const normalizedUserId = userId.trim();
  if (!USER_ID_PATTERN.test(normalizedUserId)) {
    return null;
  }

  const connectionString = resolveAuthConnectionString();
  const escapedUserId = escapeSqlLiteral(normalizedUserId);
  const rows = await queryRows<SqlAuthUserRow>(
    connectionString,
    `SELECT TOP 1
        user_id AS userId,
        username,
        password_hash AS passwordHash,
        role,
        is_active AS isActive
      FROM ${USERS_TABLE}
      WHERE user_id = N'${escapedUserId}'
        AND is_active = 1;`
  );

  const user = rows[0];
  return user ? toSafeUser(user) : null;
}
