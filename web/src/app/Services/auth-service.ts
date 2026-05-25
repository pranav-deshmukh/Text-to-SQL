import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthUser, LoginResponse, SignupPayload, UserRole } from '../Models/auth-user';

interface DecodedTokenPayload {
  sub: string;
  username: string;
  role: UserRole;
  exp: number;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly apiUrl = environment.apiUrl;
  private readonly tokenStorageKey = 'queryassist.auth.token';
  private readonly currentUserSubject = new BehaviorSubject<AuthUser | null>(this.readUserFromToken());

  readonly currentUser$ = this.currentUserSubject.asObservable();

  constructor(private readonly http: HttpClient) {}

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.apiUrl}/auth/login`, { username, password }).pipe(
      tap((response) => this.persistSession(response)),
    );
  }

  signup(payload: SignupPayload): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.apiUrl}/auth/signup`, payload).pipe(
      tap((response) => this.persistSession(response)),
    );
  }

  logout(): void {
    localStorage.removeItem(this.tokenStorageKey);
    this.currentUserSubject.next(null);
  }

  get currentUser(): AuthUser | null {
    return this.currentUserSubject.value;
  }

  get token(): string | null {
    return localStorage.getItem(this.tokenStorageKey);
  }

  get isAuthenticated(): boolean {
    return !!this.currentUser;
  }

  get role(): UserRole | null {
    return this.currentUser?.role || null;
  }

  get isTechTeam(): boolean {
    return this.role === 'tech_team';
  }

  hasRole(role: UserRole): boolean {
    return this.role === role;
  }

  restoreFromStorage(): void {
    this.currentUserSubject.next(this.readUserFromToken());
  }

  private persistSession(response: LoginResponse): void {
    localStorage.setItem(this.tokenStorageKey, response.token);
    this.currentUserSubject.next(response.user);
  }

  private readUserFromToken(): AuthUser | null {
    const token = localStorage.getItem(this.tokenStorageKey);
    if (!token) {
      return null;
    }

    const payload = this.decodeToken(token);
    if (!payload || payload.exp <= Math.floor(Date.now() / 1000)) {
      localStorage.removeItem(this.tokenStorageKey);
      return null;
    }

    return {
      userId: payload.sub,
      username: payload.username,
      role: payload.role,
    };
  }

  private decodeToken(token: string): DecodedTokenPayload | null {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    try {
      const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const normalized = payload + '='.repeat((4 - (payload.length % 4)) % 4);
      return JSON.parse(atob(normalized)) as DecodedTokenPayload;
    } catch {
      return null;
    }
  }
}
