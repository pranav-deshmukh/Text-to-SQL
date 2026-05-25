import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../Services/auth-service';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './signup.html',
  styleUrl: './signup.css',
})
export class SignupComponent {
  username = '';
  password = '';
  confirmPassword = '';
  loading = false;
  error = '';

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
  ) {}

  get passwordsMatch(): boolean {
    return this.password === this.confirmPassword;
  }

  async submit(): Promise<void> {
    if (
      this.loading ||
      !this.username.trim() ||
      !this.password ||
      !this.confirmPassword ||
      !this.passwordsMatch
    ) {
      if (!this.passwordsMatch && this.confirmPassword) {
        this.error = 'Passwords do not match.';
      }
      return;
    }

    this.loading = true;
    this.error = '';

    try {
      await firstValueFrom(
        this.authService.signup({
          username: this.username.trim(),
          password: this.password,
        }),
      );
      await this.router.navigateByUrl('/');
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        this.error = error.error?.error || error.error?.detail || 'Unable to create account.';
      } else {
        this.error = error instanceof Error ? error.message : 'Unable to create account.';
      }
    } finally {
      this.loading = false;
    }
  }
}