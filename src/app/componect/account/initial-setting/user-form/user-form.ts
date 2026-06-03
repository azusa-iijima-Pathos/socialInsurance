/**
 * ユーザ情報初期登録画面（すでに代表者が登録している情報をユーザアカウントに連携登録）
 */

import { Component, inject, Input } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { UserService } from '../../../../service/Firestore/user-service';
import { Validators } from '@angular/forms';
import { User } from '../../../../model/user';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { UPDATE_MESSAGES } from '../../../../constants/constants';
import { AuthService } from '../../../../service/Firestore/auth-service';
import { ValidationService } from '../../../../service/common/validation-service';
import { Permission } from '../../../../constants/model-constants';

@Component({
  selector: 'app-user-form',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './user-form.html',
  styleUrl: './user-form.css',
})
export class UserForm {

  private fb = inject(FormBuilder);
  private userService = inject(UserService);
  private router = inject(Router);
  private authService = inject(AuthService);
  private validationService = inject(ValidationService);

  //ログインユーザUIDをセッションストレージから取得
  uid = sessionStorage.getItem('loginUserUID');

  //あれば会社IDをセッションストレージから取得
  companyId = sessionStorage.getItem('companyId');
  //あれば権限をセッションストレージから取得
  permission = sessionStorage.getItem('permission') ? sessionStorage.getItem('permission') as Permission : '閲覧';

  finishedCompanyForm: boolean = false;

  form = this.fb.nonNullable.group({
    companyId: ['', [Validators.required, Validators.pattern('^[a-zA-Z0-9]+$')]],
    employeeId: ['', [Validators.required, Validators.pattern('^[a-zA-Z0-9]+$')]],
    //セキュリティのため、名前と生年月日を入力させる（登録はしない）
    firstName: ['', [Validators.required]],
    lastName: ['', [Validators.required]],
    birthDate: ['', [Validators.required]],
  });

  message: string = '';
  errorMessage: string = '';

  ngOnInit() {
    const message = history.state.message;
    if (message) {
      this.message = message;
      history.replaceState({}, '');
    }
    this.finishedCompanyForm = history.state?.finishedCompanyForm === true;
  }

  //アカウントと社員情報の連携登録
  async register() {
    this.form.setErrors(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    //社員情報の連携登録バリデーション
    const employeeValidationError = await this.validationService.validateEmployee(this.form);
    if (employeeValidationError) {
      this.form.setErrors(employeeValidationError);
      this.form.markAllAsTouched();
      return;
    }

    const user: Partial<User> = {
      uid: this.uid!,
      permission: this.permission,
      companyId: this.form.value.companyId!,
      employeeId: this.form.value.employeeId!,
    };
    const result = await this.userService.updateUser(user);
    if (!result) {
      this.errorMessage = UPDATE_MESSAGES.FAILED;
      return;
    }

    //ログインユーザ情報をセッションストレージに保存
    sessionStorage.setItem('loginEmployeeId', user.employeeId!);
    //ログインユーザ情報をキャッシュにセット
    this.authService.loginUser.set(user as User);
    //セッションストレージのログインユーザUIDを削除
    sessionStorage.removeItem('loginUserUID');
    //セッションストレージの会社IDを登録（もしくは上書き）
    sessionStorage.setItem('companyId', user.companyId!);

    this.router.navigate(['/top']);
  }

  toCompanyForm() {
    this.router.navigate(['/initial-setting/company-form']);
  }

  toContinueCompanyForm() {
    this.router.navigate([`/initial-setting/${this.companyId}/office-form`]);
  }

}
