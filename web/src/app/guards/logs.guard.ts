import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { environment } from '../../environments/environment';

export const logsGuard: CanActivateFn = () => {
  const router = inject(Router);

  if (!environment.enableLogsUi) {
    return router.createUrlTree(['/']);
  }

  return true;
};
