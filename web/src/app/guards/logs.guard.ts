import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { QueryService } from '../Services/query-service';

export const logsGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const queryService = inject(QueryService);

  if (environment.production) {
    return router.createUrlTree(['/']);
  }

  try {
    const config = await firstValueFrom(queryService.getRuntimeConfig());
    const appEnv = config.audit?.appEnv || (environment.production ? 'prod' : 'dev');
    const uiEnabled = config.audit?.uiEnabled === true;

    if (appEnv === 'prod' || !uiEnabled) {
      return router.createUrlTree(['/']);
    }

    return true;
  } catch {
    return router.createUrlTree(['/']);
  }
};
