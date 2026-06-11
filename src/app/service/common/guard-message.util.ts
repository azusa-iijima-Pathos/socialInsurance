import { ActivatedRoute, Router } from '@angular/router';
import { GURARD_MESSAGES } from '../../constants/constants';

export type GuardMessageCode = 'sessionExpired' | 'noPermission' | 'companyMismatch';

export function resolveGuardMessage(code: string | null): string {
  switch (code) {
    case 'sessionExpired':
      return GURARD_MESSAGES.SESSION_EXPIRED;
    case 'noPermission':
      return GURARD_MESSAGES.NO_PERMISSION;
    case 'companyMismatch':
      return GURARD_MESSAGES.COMPANY_MISMATCH;
    default:
      return '';
  }
}

/** ガード遷移時の queryParams.message を表示用テキストに変換し、URL から除去する */
export function consumeGuardMessage(route: ActivatedRoute, router: Router): string {
  const code = route.snapshot.queryParamMap.get('message');
  const message = resolveGuardMessage(code);
  if (code) {
    void router.navigate([], {
      relativeTo: route,
      queryParams: { message: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
  return message;
}
