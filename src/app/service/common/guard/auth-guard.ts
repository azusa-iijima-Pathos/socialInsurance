import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';

type GuardMessageCode = 'sessionExpired' | 'noPermission' | 'companyMismatch';

function redirectToLogin(router: Router) {
  return router.createUrlTree(['/login'], {
    queryParams: { message: 'sessionExpired' },
  });
}

function redirectByPermission(router: Router, permission: string | null, message: GuardMessageCode = 'noPermission') {
  if (!permission) {
    return redirectToLogin(router);
  }
  if (permission === '管理' || permission === '承認') {
    return router.createUrlTree(['/top-for-manage'], {
      queryParams: { message },
    });
  }
  return router.createUrlTree(['/top-for-employee'], {
    queryParams: { message },
  });
}

/** ログイン済み（社員連携済み or 初期設定中の UID のみ） */
export const authGuard: CanActivateFn = (_route, _state) => {
  const router = inject(Router);
  const loginEmployeeId = sessionStorage.getItem('loginEmployeeId');
  const loginUserUID = sessionStorage.getItem('loginUserUID');

  if (loginEmployeeId || loginUserUID) {
    return true;
  }
  return redirectToLogin(router);
};

/** 初期設定フロー（会社登録〜社員 CSV 登録） */
export const initialSettingGuard: CanActivateFn = (_route, _state) => {
  const router = inject(Router);
  const loginUserUID = sessionStorage.getItem('loginUserUID');
  const loginEmployeeId = sessionStorage.getItem('loginEmployeeId');

  if (loginUserUID || loginEmployeeId) {
    return true;
  }
  return redirectToLogin(router);
};

export const companyGuard: CanActivateFn = (route, _state) => {
  const router = inject(Router);
  const sessionCompanyId = sessionStorage.getItem('companyId');
  const paramCompanyId = route.paramMap.get('companyId');
  const permission = sessionStorage.getItem('permission');

  if (!sessionCompanyId) {
    return redirectToLogin(router);
  }

  // URL に companyId があるルートのみセッションと照合
  if (paramCompanyId && paramCompanyId !== sessionCompanyId) {
    return redirectByPermission(router, permission, 'companyMismatch');
  }

  const requiredPermission = route.data?.['permission'];
  if (requiredPermission) {
    if (!permission) {
      return redirectToLogin(router);
    }

    if (permission === requiredPermission || permission === '管理') {
      return true;
    }

    return redirectByPermission(router, permission);
  }

  return true;
};
