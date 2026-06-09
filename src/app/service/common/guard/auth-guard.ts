import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';

export const authGuard: CanActivateFn = (_route, _state) => {
  // const router = inject(Router);
  // const userId = sessionStorage.getItem('loginUserId');

  // if (!userId) {
  //   //ユーザIDがない場合はログイン画面に遷移
  //   return router.createUrlTree(['/login'], {
  //     queryParams: { message: 'sessionExpired' }
  //   });
  // }
  return true;
};

export const initialSettingGuard: CanActivateFn = (_route, _state) => {
  // const router = inject(Router);
  // const UID = sessionStorage.getItem('loginUserUID');

  // if (!UID) {
  //   //UIDがない場合はログイン画面に遷移
  //   return router.createUrlTree(['/login'], {
  //     queryParams: { message: 'sessionExpired' }
  //   });
  // } else {
  //   return true;
  // }
  return true;
};


export const companyGuard: CanActivateFn = (route, _state) => {

  const router = inject(Router);
  const sessionCompanyId = sessionStorage.getItem('companyId');
  const paramCompanyId = route.paramMap.get('companyId');

  const permission = sessionStorage.getItem('permission');

  // //会社IDがない場合
  // if (!sessionCompanyId) {
  //   return router.createUrlTree(['/login'], {
  //     queryParams: { message: 'sessionExpired' }
  //   });
  // }

  // //会社IDが一致していない場合
  // if (sessionCompanyId && paramCompanyId !== sessionCompanyId) {
  //   //セッションのプロジェクトIDがある場合はトップ画面に遷移
  //   if (!permission) {
  //     return router.createUrlTree(['/login'], {
  //       queryParams: { message: 'sessionExpired' }
  //     });
  //   } else if (permission === '管理' || permission === '承認') {
  //     return router.createUrlTree(['/top-for-manage'], {
  //       queryParams: { message: 'noPermission' }
  //     });
  //   } else {
  //     return router.createUrlTree(['/top-for-employee'], {
  //       queryParams: { message: 'noPermission' }
  //     });
  //   }
  // }

  // //権限必要な場合
  // const requiredPermission = route.data?.['permission'];
  // if (requiredPermission) {

  //   //権限がない場合
  //   if (!permission) {
  //     return router.createUrlTree(['/login'], {
  //       queryParams: { message: 'sessionExpired' }
  //     });
  //   }

  //   //権限が一致している場合もしくは管理権限の場合
  //   if (permission === requiredPermission || permission === '管理') {
  //     return true;
  //   } else {
  //     if (permission === '承認') {
  //       return router.createUrlTree(['/top-for-manage'], {
  //         queryParams: { message: 'noPermission' }
  //       });
  //     } else {
  //       return router.createUrlTree(['/top-for-employee'], {
  //         queryParams: { message: 'noPermission' }
  //       });
  //     }
  //   }

  // }

  return true;
};