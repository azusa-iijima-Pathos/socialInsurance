import { Injectable, inject } from '@angular/core';
import {
  Auth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updatePassword,
  signOut,
  sendPasswordResetEmail,
  getAuth,
  EmailAuthProvider,
  reauthenticateWithCredential,
  verifyBeforeUpdateEmail,
  UserCredential,
} from '@angular/fire/auth';
import { AUTH_ERROR_MESSAGES, UPDATE_MESSAGES } from '../../constants/constants';
import { CrudService } from '../common/crud-service';
import { User } from '../../model/user';
import { signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class AuthService {

  private auth = inject(Auth);
  private crudService = inject(CrudService);

  //ログインユーザ情報
  loginUser = signal<User | null>(null);

  //Firebaseでユーザ新規登録
  registerFirebase(email: string, password: string) {
    return createUserWithEmailAndPassword(this.auth, email, password);
  }

  //Firebaseでユーザログイン
  async login(email: string, password: string) {
    const result: UserCredential = await signInWithEmailAndPassword(this.auth, email, password);
    const userAccount: User | null = await this.getUserAccount(result);
    return { credential: result, user: userAccount };
  }

  //Firebaseでユーザパスワードリセット
  resetPassword(email: string) {
    return sendPasswordResetEmail(this.auth, email);
  }

  //Firebaseで認証確認
  async reauthenticate(currentPassword: string): Promise<string | null> {

    const auth = getAuth();
    const user = auth.currentUser;

    let errorMessage: string | null = null;

    if (!user) {
      errorMessage = AUTH_ERROR_MESSAGES.USER_NOT_FOUND;
    }
    const credential = EmailAuthProvider.credential(user!.email!, currentPassword);
    try {
      await reauthenticateWithCredential(user!, credential);
    } catch (error: any) {
      errorMessage = AUTH_ERROR_MESSAGES.AUTHENTICATION_FAILED;
    }
    return errorMessage;
  }

  //Firebaseでユーザパスワード更新
  async updatePasswordAndEmail(_currentPassword: string, newPassword?: string, newEmail?: string): Promise<{ code: string, message: string }[]> {
    const auth = getAuth();
    const user = auth.currentUser;

    let messages: { code: string, message: string }[] = [];

    try {
      if (newEmail && newEmail !== user!.email) {
        await verifyBeforeUpdateEmail(user!, newEmail);
        messages.push({ code: 'EMAIL', message: AUTH_ERROR_MESSAGES.EMAIL_SENT });
      }
      if (newPassword) {
        await updatePassword(user!, newPassword);
        messages.push({ code: 'PASSWORD', message: AUTH_ERROR_MESSAGES.PASSWORD_RESET_SUCCESS });
      }
      return messages;
    } catch (error: any) {
      console.error(error);
      if (error.code === 'auth/invalid-email') {
        messages.push({ code: 'ERROR', message: AUTH_ERROR_MESSAGES.EMAIL_INVALID });
      } else if (error.code === 'auth/email-already-in-use') {
        messages.push({ code: 'ERROR', message: AUTH_ERROR_MESSAGES.EMAIL_ALREADY_IN_USE });
      } else {
        messages.push({ code: 'ERROR', message: UPDATE_MESSAGES.FAILED });
      }
      return messages;
    }
  }

  //Firebaseでユーザログアウト
  logout() {
    return signOut(this.auth);
  }

  //認証アカウントからユーザ情報を取得
  async getUserAccount(loggedInUser: UserCredential) {
    const uid = (await loggedInUser).user.uid;
    const userAccount: User | null = await this.crudService.getById(`users/${uid}`, 'uid');
    return userAccount;
  }

}

