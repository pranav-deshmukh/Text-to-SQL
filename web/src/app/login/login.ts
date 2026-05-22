import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../Services/auth-service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class LoginComponent {
  username = '';
  password = '';
  loading = false;
  error = '';

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
  ) {}

  async submit(): Promise<void> {
    if (!this.username.trim() || !this.password.trim() || this.loading) {
      return;
    }

    this.loading = true;
    this.error = '';

    try {
      await firstValueFrom(this.authService.login(this.username.trim(), this.password));
      const redirectTo = this.route.snapshot.queryParamMap.get('redirectTo') || '/';
      await this.router.navigateByUrl(redirectTo);
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        this.error = error.error?.error || error.error?.detail || 'Unable to sign in.';
      } else {
        this.error = error instanceof Error ? error.message : 'Unable to sign in.';
      }
    } finally {
      this.loading = false;
    }
  }
}
