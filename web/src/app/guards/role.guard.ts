import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../Services/auth-service';
import { UserRole } from '../Models/auth-user';

export function roleGuard(role: UserRole): CanActivateFn {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    authService.restoreFromStorage();

    if (authService.hasRole(role)) {
      return true;
    }

    return router.createUrlTree(['/']);
  };
}
