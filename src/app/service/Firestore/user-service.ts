import { Injectable, inject } from '@angular/core';
import { CrudService } from '../common/crud-service';
import { User } from '../../model/user';

@Injectable({
  providedIn: 'root',
})
export class UserService {

  private crudService = inject(CrudService);

  //ユーザ新規登録(UIDの連携のみ、その後設定画面へ進んで情報更新してもらう)
  registerAccount(uid: string): Promise<boolean> {
    return this.crudService.create(`users/${uid}`, {
      uid: uid,
    });
  }

  //ユーザ情報更新（true:成功、false:失敗）
  updateUser(user: Partial<User>): Promise<boolean> {
    return this.crudService.update(`users/${user.uid}`, user);
  }

  //会社IDに紐づくユーザ情報を取得
  getUsersByCompanyId(companyId: string): Promise<User[]> {
    return this.crudService.getByField(`users`, 'companyId', companyId, 'uid');
  }

  async getUserByEmployeeId(companyId: string, employeeId: string): Promise<User | null> {
    const users = await this.getUsersByCompanyId(companyId);
    return users.find(user => user.employeeId === employeeId) ?? null;
  }

}
