import { SOCIAL_INSURANCE_REQUIRED } from '../insuranceData/forCompany';

/**
 * エラーメッセージ
 */

export const UPDATE_MESSAGES = {
  SUCCESS: '更新しました',
  FAILED: '更新に失敗しました',
};

export const CREATE_MESSAGES = {
  SUCCESS: '新規登録しました',
  FAILED: '新規登録に失敗しました',
};

export const DELETE_MESSAGES = {
  SUCCESS: '削除しました',
  FAILED: '削除に失敗しました',
};

export const AUTH_ERROR_MESSAGES = {
  USER_NOT_FOUND: 'ユーザが見つかりません',
  AUTHENTICATION_FAILED: '認証に失敗しました',

  PASSWORD_RESET_FAILED: 'パスワード更新失敗しました',
  PASSWORD_RESET_SUCCESS: 'パスワードを更新しました',
  PASSWORD_WEAK: 'パスワードは6文字以上で入力してください',

  EMAIL_ALREADY_IN_USE: 'メールアドレスはすでに使用されています',
  EMAIL_INVALID: 'メールアドレスが無効です',
  EMAIL_NOT_CORRECT: 'メールアドレスを正しく入力してください',

  EMAIL_SENT: 'メールを送信しました。メールを確認してください。',
  EMAIL_NOT_SENT: 'メールを送信できませんでした',

  REGISTER_FAILED: '登録に失敗しました',
  REGISTER_SUCCESS: '登録が完了しました。ログイン画面からログインしてください。',

  LOGIN_WITHOUT_NAME: '初期設定がされていません。設定画面からユーザ情報を登録してください。',
};

export const LOGIN_ERROR_MESSAGES = 'メールアドレスまたはパスワードが間違っています';

export const GURARD_MESSAGES = {
  SESSION_EXPIRED: 'セッションが切れたため、再ログインしてください。',
  NO_PERMISSION: '権限がないためアクセスできません。',
};

export const COMPANY_FORM_MESSAGES = {
  SPECIFIC_APPLICABLE_OFFICE_SPECIALCASE: `※${SOCIAL_INSURANCE_REQUIRED.SPECIFIC_APPLICABLE_OFFICE_EXCEPTION_BUSINESS_TYPES}の場合は、手動で特定適用事業所を選択してください。`,
  SPECIFIC_APPLICABLE_OFFICE_DESCRIPTION: SOCIAL_INSURANCE_REQUIRED.SPECIFIC_APPLICABLE_OFFICE_DESCRIPTION,
}
