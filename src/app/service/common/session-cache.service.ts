import { inject, Injectable } from '@angular/core';
import { AuthService } from '../Firestore/auth-service';
import { CompanyService } from '../Firestore/company-service';
import { EmployeeService } from '../Firestore/employee-service';
import { OfficeService } from '../Firestore/office-service';
import { PayrollService } from '../Firestore/payroll-service';

/**
 * ログインセッションに紐づくインメモリキャッシュを一括リセットする
 */
@Injectable({
  providedIn: 'root',
})
export class SessionCacheService {

  private authService = inject(AuthService);
  private employeeService = inject(EmployeeService);
  private payrollService = inject(PayrollService);
  private companyService = inject(CompanyService);
  private officeService = inject(OfficeService);

  clearAllCaches(): void {
    this.employeeService.resetCache();
    this.payrollService.resetCache();
    this.companyService.resetCache();
    this.officeService.resetCache();
    this.authService.loginUser.set(null);
  }

  /** ログイン直後に会社スコープのデータを再読込する */
  async reloadSessionData(): Promise<void> {
    await Promise.all([
      this.companyService.getCompany(true),
      this.employeeService.getAllEmployees(true),
      this.officeService.getAllOffice(true),
    ]);
  }
}
