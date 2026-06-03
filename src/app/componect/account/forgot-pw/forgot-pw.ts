import { Component, inject } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../../service/Firestore/auth-service';
import { AUTH_ERROR_MESSAGES } from '../../../constants/constants';

@Component({
  selector: 'app-forgot-pw',
  imports: [ReactiveFormsModule, CommonModule],
  templateUrl: './forgot-pw.html',
  styleUrl: './forgot-pw.css',
})
export class ForgotPW {

  private authService = inject(AuthService);
  private fb = inject(FormBuilder);
  private router = inject(Router);

  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  message?: string = '';
  resetCompleted = false;

  async resetPassword() {
    if (this.resetCompleted) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    try {
      await this.authService.resetPassword(this.form.value.email!);
      this.message = AUTH_ERROR_MESSAGES.EMAIL_SENT;
      this.resetCompleted = true;
    } catch (error: any) {
      console.error(error.code);
      this.message = AUTH_ERROR_MESSAGES.PASSWORD_RESET_FAILED;
    }
  }

  login() {
    this.router.navigate(['/login']);
  }


}
