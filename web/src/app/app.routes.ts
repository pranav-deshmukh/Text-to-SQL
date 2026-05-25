import { Routes } from '@angular/router';
import { QuotesComponent } from './quotes/quotes';
import { LogsComponent } from './logs/logs';
import { LoginComponent } from './login/login';
import { SignupComponent } from './signup/signup';
import { authGuard } from './guards/auth.guard';
import { logsGuard } from './guards/logs.guard';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent,
  },
  {
    path: 'signup',
    component: SignupComponent,
  },
  {
    path: '',
    component: QuotesComponent,
    canActivate: [authGuard],
  },
  {
    path: 'chat/:conversationId',
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
