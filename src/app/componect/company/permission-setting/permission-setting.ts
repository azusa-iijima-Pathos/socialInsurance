import { Component, inject, signal } from '@angular/core';
import { User } from '../../../model/user';
import { UserService } from '../../../service/Firestore/user-service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { PERMISSIONS } from '../../../constants/model-constants';
import { UPDATE_MESSAGES } from '../../../constants/constants';
import { Router } from '@angular/router';

@Component({
  selector: 'app-permission-setting',
  imports: [CommonModule, FormsModule],
  templateUrl: './permission-setting.html',
  styleUrl: './permission-setting.css',
})
export class PermissionSetting {

  PERMISSIONS = PERMISSIONS;
  private userService = inject(UserService);
  commonService = inject(CommonService);
  private employeeService = inject(EmployeeService);
  private router = inject(Router);  

  companyId = sessionStorage.getItem('companyId');
  loginEmployeeId = sessionStorage.getItem('loginEmployeeId');

  users = signal<User[]>([]);
  permissionForUpdate: Record<string, User['permission']> = {};
  message: string = '';
  private messageTimer: MessageTimer = null;

  async ngOnInit() {
    await this.employeeService.getAllEmployees();
    const users = await this.userService.getUsersByCompanyId(this.companyId!);
    this.users.set(users);
    users.forEach(user => this.permissionForUpdate[user.uid] = user.permission);
  }

  async saveAllPermissions() {
    const results = await Promise.all(this.users().map(user =>
      this.userService.updateUser({
        uid: user.uid,
        permission: this.permissionForUpdate[user.uid],
      })
    ));

    const failedCount = results.filter(result => !result).length;
    if (failedCount) {
      this.showMessage(`権限更新に失敗しました：${failedCount}件`);
      return;
    }

    this.showMessage(`権限を${UPDATE_MESSAGES.SUCCESS}`);

    //更新後のユーザー情報を取得
    const users = await this.userService.getUsersByCompanyId(this.companyId!);
    this.users.set(users);
    users.forEach(user => this.permissionForUpdate[user.uid] = user.permission);
  }

  private showMessage(message: string) {
    this.messageTimer = this.commonService.showTimedMessage(message, value => this.message = value, this.messageTimer);
  }

  toSetting() {
    this.router.navigate(['/company-setting']);
  }

  toAddEmployee() {
    this.router.navigate(['/employee-addInsurance']);
  }

}
