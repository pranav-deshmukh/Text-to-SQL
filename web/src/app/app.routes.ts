import { Routes } from '@angular/router';
import { QuotesComponent } from './quotes/quotes';
import { LogsComponent } from './logs/logs';
import { logsGuard } from './guards/logs.guard';

export const routes: Routes = [
  {
    path: '',
    component: QuotesComponent,
  },
  {
    path: 'logs',
    component: LogsComponent,
    canActivate: [logsGuard],
  },
];
