import { Component, inject } from '@angular/core';
import { AuthService } from '../../../service/Firestore/auth-service';
import { FormBuilder, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AUTH_ERROR_MESSAGES, GURARD_MESSAGES, CREATE_MESSAGES } from '../../../constants/constants';
import { UserService } from '../../../service/Firestore/user-service';
import { CompanyService } from '../../../service/Firestore/company-service';

@Component({
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {

  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private userService = inject(UserService);
  private companyService = inject(CompanyService);

  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]]
  });

  errorMessage: string = '';

  /** パスワード欄の表示切替 */
  showPassword = false;

  ngOnInit() {
    const guardMessageCode = this.route.snapshot.queryParamMap.get('message');
    // 遷移元state優先、なければガードのqueryParamsコードを表示文に変換
    this.errorMessage =
      history.state?.message ||
      history.state?.transferMessage ||
      this.toGuardMessage(guardMessageCode);
    if (this.errorMessage) {
      history.replaceState({}, '');
    }
    if (guardMessageCode) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    }
  }

  private toGuardMessage(code: string | null): string {
    switch (code) {
      case 'sessionExpired':
        return GURARD_MESSAGES.SESSION_EXPIRED;
      case 'noPermission':
        return GURARD_MESSAGES.NO_PERMISSION;
      default:
        return '';
    }
  }

  async login() {
    if (this.form.invalid) {
      //すべてのフォームのエラーを表示
      this.form.markAllAsTouched();
      return;
    }
    this.errorMessage = '';

    let result;
    try {
      result = await this.authService.login(this.form.value.email!, this.form.value.password!);
    } catch (error) {
      console.error(error);
      this.errorMessage = AUTH_ERROR_MESSAGES.AUTHENTICATION_FAILED;
      return;
    }

    if (!result.credential) {
      this.errorMessage = AUTH_ERROR_MESSAGES.AUTHENTICATION_FAILED;
      return;
    }
    //Firebaseでログイン成功、DBにユーザ情報がない場合は新規登録
    if (!result.user || result.user.employeeId === undefined) {
      //DBにデータがない場合、DBにアカウント作成
      if (!result.user) {
        //ユーザ情報を新規登録（UIDの連携のみでアカウント作成）
        const registerResult = await this.userService.registerAccount(result.credential.user.uid!);
        if (!registerResult) {
          const message = `${CREATE_MESSAGES.FAILED} 再度ログインしなおしてください`;
          this.router.navigate(['/login'], { state: { message } });
          return;
        }
      } else if (result.user.companyId && result.user.permission === '管理') {
        //会社IDをセッションストレージに保存
        sessionStorage.setItem('companyId', result.user.companyId!);
        sessionStorage.setItem('permission', result.user.permission!);
      }
      //会社と連携していない場合
      const message = AUTH_ERROR_MESSAGES.LOGIN_WITHOUT_NAME;
      //一時的にUIDをセッションストレージに保存
      sessionStorage.setItem('loginUserUID', result.credential.user.uid!);
      this.router.navigate(['/initial-setting/user-form'], { state: { message } });
      return;
    }
    //ログイン成功時かつ会社と連携している場合、ユーザID情報をセッションストレージに保存
    sessionStorage.setItem('loginEmployeeId', result.user!.employeeId!);
    sessionStorage.setItem('companyId', result.user!.companyId!);
    sessionStorage.setItem('permission', result.user!.permission!);

    //社会保険料の確定月と確定日をセッションストレージに保存
    await this.companyService.getCompany(true);
    // sessionStorage.setItem('comfirmMonth', this.companyService.company()?.settings?.insuranceCloseingMonth ?? '');
    // sessionStorage.setItem('comfirmDate', this.companyService.company()?.settings?.insuranceCloseingDate?.toString() ?? '');
    const settings = this.companyService.company()?.settings;
    const workingMonth = settings?.workingMonth;
    if (workingMonth) {
      sessionStorage.setItem('workingMonth', workingMonth.toString());
      sessionStorage.setItem('workingYear', (settings?.workingYear ?? this.getCurrentYearForLegacySettings()).toString());
    } else {
      sessionStorage.removeItem('workingMonth');
      sessionStorage.removeItem('workingYear');
    }

    //ログインユーザ情報をキャッシュにセット
    this.authService.loginUser.set(result.user!);

    if (result.user!.permission === '管理' || result.user!.permission === '承認') {
      this.router.navigate(['/top-for-manage']);
    } else {
      this.router.navigate(['/top-for-employee']);
    }
  }

  private getCurrentYearForLegacySettings(): number {
    return new Date().getFullYear();
  }

}

