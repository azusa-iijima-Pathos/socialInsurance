import { Component, computed, EnvironmentInjector, inject, runInInjectionContext, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Location } from '@angular/common';
import { AuthService } from '../../../service/Firestore/auth-service';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SessionCacheService } from '../../../service/common/session-cache.service';
import { CommonService } from '../../../service/common/common-service';

@Component({
  selector: 'app-header',
  imports: [CommonModule],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class Header {

  private location = inject(Location);
  private authService = inject(AuthService);
  private router = inject(Router);
  private sessionCacheService = inject(SessionCacheService);
  private injector = inject(EnvironmentInjector);
  commonService = inject(CommonService);
  private hasSession = signal(false);

  loginEmployeeId = signal<string | null>(null);
  companyId = signal<string | null>(null);
  permission = signal<string | null>(null);
  workingYear = signal<string | null>(null);
  workingMonth = signal<string | null>(null);
  showHeaderActions = computed(() => this.hasSession());

  constructor() {
    this.syncSession();
    this.router.events
      .pipe(
        //NavigationEnd は、Angular Router の「画面遷移が完了したタイミング」を表すイベント
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        //filter(...) の結果が次の takeUntilDestroyed() に渡って、takeUntilDestroyed() は、ヘッダーが破棄されたときに購読を自動解除するためのAngular標準の書き方
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.syncSession();
      });
  }

  // セッションストレージのログイン情報をヘッダー表示用のsignalへ反映する
  private syncSession() {
    //!! は、値を boolean（true / false）に変換する 書き方
    this.hasSession.set(!!sessionStorage.getItem('loginEmployeeId') || !!sessionStorage.getItem('loginUserUID'));
    this.loginEmployeeId.set(sessionStorage.getItem('loginEmployeeId'));
    this.companyId.set(sessionStorage.getItem('companyId'));
    this.permission.set(sessionStorage.getItem('permission'));
    this.workingYear.set(sessionStorage.getItem('workingYear'));
    this.workingMonth.set(sessionStorage.getItem('workingMonth'));
    const companyId = sessionStorage.getItem('companyId');
    if (companyId) {
      runInInjectionContext(this.injector, () => {
        void this.commonService.getCurrentTargetPeriod();
      });
    } else {
      this.commonService.resetTargetPeriodCache();
    }
  }

  toTop() {
    if (this.permission() === '管理' || this.permission() === '承認') {
      this.router.navigate(['/top-for-manage']);
    } else {
      this.router.navigate(['/top-for-employee']);
    }
  }

  //戻る
  back() {
    this.location.back();
  }

  //ログアウト
  logout() {
    sessionStorage.removeItem('loginEmployeeId');
    sessionStorage.removeItem('loginUserUID');
    sessionStorage.removeItem('companyId');
    sessionStorage.removeItem('permission');
    sessionStorage.removeItem('workingYear');
    sessionStorage.removeItem('workingMonth');
    this.sessionCacheService.clearAllCaches();
    this.syncSession();
    void this.authService.logout();
    void this.router.navigate(['/login']);
  }

  //従業員トップに（管理と承認の場合のみ）
  toEmployeeTop() {
      this.router.navigate(['/top-for-employee']);
  }

  //管理者トップに（管理と承認の場合のみ）
  toManageTop() {
    this.router.navigate(['/top-for-manage']);
  }

}
