export type UserRole = "end_user" | "tech_team";

export interface AuthenticatedUser {
  userId: string;
  username: string;
  role: UserRole;
}

/** Safe user record (no password). Used as return type from user lookups. */
export interface AuthUserRecord extends AuthenticatedUser {}
