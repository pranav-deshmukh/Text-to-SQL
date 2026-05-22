export type UserRole = 'end_user' | 'tech_team';

export interface AuthUser {
  userId: string;
  username: string;
  role: UserRole;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}
