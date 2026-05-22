import { Routes } from '@angular/router';
import { QuotesComponent } from './quotes/quotes';
import { LogsComponent } from './logs/logs';
import { LoginComponent } from './login/login';
import { authGuard } from './guards/auth.guard';
import { logsGuard } from './guards/logs.guard';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent,
  },
  {
    path: '',
    component: QuotesComponent,
    canActivate: [authGuard],
  },
  {
    path: 'logs',
    component: LogsComponent,
    canActivate: [logsGuard],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
