import { Component, inject } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthService } from '../../../service/Firestore/auth-service';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { UserService } from '../../../service/Firestore/user-service';
import { AUTH_ERROR_MESSAGES } from '../../../constants/constants';

@Component({
    selector: 'app-register',
    imports: [ReactiveFormsModule, CommonModule],
    templateUrl: './register.html',
    styleUrl: './register.css',
})
export class Register {

    private fb = inject(FormBuilder);
    private authService = inject(AuthService);
    private router = inject(Router);
    private userService = inject(UserService);

    form = this.fb.nonNullable.group({
        email: ['', [Validators.required, Validators.email]],
        password: ['', [Validators.required, Validators.minLength(6)]],
    });

    message?: string = '';
    registered = false;

    /** パスワード欄の表示切替 */
    showPassword = false;

    async register() {
        if (this.registered) {
            return;
        }
        if (this.form.invalid) {
            this.form.markAllAsTouched();
            return;
        }
        try {
            //Firebaseでアカウント作成
            const result = await this.authService.registerFirebase(this.form.value.email!, this.form.value.password!);
            const uid = result.user.uid;

            //Firebaseでアカウント作成成功、DBにユーザ情報を作成
            const registerResult = await this.userService.registerAccount(uid);
            if (!registerResult) {
                this.message = AUTH_ERROR_MESSAGES.REGISTER_FAILED;
                return;
            }
            this.message = AUTH_ERROR_MESSAGES.REGISTER_SUCCESS;
            this.registered = true;
        } catch (error: any) {
            if (error.code === 'auth/email-already-in-use') {
                this.message = AUTH_ERROR_MESSAGES.EMAIL_ALREADY_IN_USE;
            } else if (error.code === 'auth/weak-password') {
                this.message = AUTH_ERROR_MESSAGES.PASSWORD_WEAK;
            } else if (error.code === 'auth/invalid-email') {
                this.message = AUTH_ERROR_MESSAGES.EMAIL_NOT_CORRECT;
            } else {
                this.message = AUTH_ERROR_MESSAGES.REGISTER_FAILED;
            }
            console.error(error);
        }
    }

    //ログイン画面に遷移
    login() {
        this.router.navigate(['/login']);
    }

}
