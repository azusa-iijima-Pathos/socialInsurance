import { Injectable, inject, signal } from '@angular/core';
import { CrudService } from '../common/crud-service';
import { Payroll } from '../../model/payroll';
import { PayrollLockService } from './payroll-lock-service';

/**
 * 給与・勤務実績サービス
 */
//PATH: companies/{companyId}/employees/{employeeId}/payroll/{payrollId}

@Injectable({
  providedIn: 'root',
})
export class PayrollService {

  private crudService = inject(CrudService);
  private payrollLockService = inject(PayrollLockService);

  private get path(): string {
    const companyId = sessionStorage.getItem('companyId');
    return `companies/${companyId}/employees`;
  }

  private get companyId(): string | null {
    return sessionStorage.getItem('companyId');
  }

  //給与・勤務実績IDを作成
  private createPayrollId(payroll: Partial<Payroll>): string {
    if (payroll.payrollId) {
      return payroll.payrollId;
    }

    if (payroll.type === '賞与') {
      if (!payroll.paymentDate) {
        throw new Error('paymentDate is required to create payrollId');
      }
      const date = payroll.paymentDate!.toDate();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      return `${year}-${month}_bonus`;
    }

    const targetPeriodStart = payroll.targetPeriod?.[0];
    if (!targetPeriodStart) {
      throw new Error('targetPeriodStart is required to create payrollId');
    }

    const date = targetPeriodStart.toDate();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  //給与・勤務実績を1件取得（すでにデータがあるか確認用）
  async getPayroll(employeeId: string, payroll: Partial<Payroll>): Promise<Payroll | null> {
    const payrollId = this.createPayrollId(payroll);
    return await this.crudService.getById<Payroll>(`${this.path}/${employeeId}/payroll/${payrollId}`, 'payrollId');
  }

  //新規作成
  async registerPayroll(employeeId: string, payroll: Partial<Payroll>) {
    const payrollId = this.createPayrollId(payroll);
    if (await this.payrollLockService.isPayrollLocked(payrollId)) {
      return false;
    }
    const existingPayroll = await this.getPayroll(employeeId, payroll);
    if (existingPayroll) {
      return false;
    }

    return await this.crudService.create<Payroll>(
      `${this.path}/${employeeId}/payroll/${payrollId}`,
      {
        ...payroll,
        payrollId,
        employeeId,
      }
    );
  }

  /** 確定済み月の給与修正用新規登録（ロック済みでも登録可能） */
  async registerPayrollForCorrection(employeeId: string, payroll: Partial<Payroll>) {
    const payrollId = this.createPayrollId(payroll);
    const existingPayroll = await this.getPayroll(employeeId, payroll);
    if (existingPayroll) {
      return false;
    }

    const result = await this.crudService.create<Payroll>(
      `${this.path}/${employeeId}/payroll/${payrollId}`,
      {
        ...payroll,
        payrollId,
        employeeId,
      },
    );
    if (result) {
      await this.getAllPayrollListForMonth(payrollId, true);
    }
    return result;
  }

  //全従業員の該当月の給与・勤務実績一覧を取得
  allPayrollListForMonth = signal<{payrollId: string, payrollList: Payroll[]}[]>([]);
  isAllPayrollListForMonthLoaded: { [key: string]: boolean } = {};
  private cachedCompanyId = '';

  resetCache(): void {
    this.allPayrollListForMonth.set([]);
    this.isAllPayrollListForMonthLoaded = {};
    this.cachedCompanyId = '';
  }

  async getAllPayrollListForMonth(payrollId: string, forceReload: boolean = false) {
    const companyId = sessionStorage.getItem('companyId') ?? '';
    if (this.cachedCompanyId !== companyId) {
      forceReload = true;
      this.isAllPayrollListForMonthLoaded = {};
      this.cachedCompanyId = companyId;
    }
    if (!payrollId) return;
    if (this.isAllPayrollListForMonthLoaded[payrollId] && !forceReload) return;

    const payrollList = await this.crudService.getByCollectionGroupFields<Payroll>(
      'payroll',
      [
        { field: 'companyId', value: this.companyId },
        { field: 'payrollId', value: payrollId },
      ],  
      'payrollId'
    );
    const currentList = this.allPayrollListForMonth();
    this.allPayrollListForMonth.set([
      ...currentList.filter(item => item.payrollId !== payrollId),
      { payrollId, payrollList },
    ]);
    this.isAllPayrollListForMonthLoaded[payrollId] = true;
  }

  //給与・勤務実績を1件削除
  async deletePayroll(payroll: Payroll) {
    if (!payroll.employeeId || !payroll.payrollId) {
      return false;
    }
    if (await this.payrollLockService.isPayrollLocked(payroll.payrollId)) {
      return false;
    }
    const result = await this.crudService.delete(`${this.path}/${payroll.employeeId}/payroll/${payroll.payrollId}`);
    if (!result) {
      return false;
    }
    await this.getAllPayrollListForMonth(payroll.payrollId, true);
    return true;
  }

  //給与・勤務実績を1件更新
  async updatePayroll(payroll: Partial<Payroll>) {
    if (!payroll.employeeId || !payroll.payrollId) {
      return false;
    }
    if (await this.payrollLockService.isPayrollLocked(payroll.payrollId)) {
      return false;
    }
    const result = await this.crudService.update<Payroll>(
      `${this.path}/${payroll.employeeId}/payroll/${payroll.payrollId}`,
      payroll
    );
    if (!result) {
      return false;
    }
    await this.getAllPayrollListForMonth(payroll.payrollId, true);
    return true;
  }

  // 確定済み給与・賞与の修正用更新（ロック済みでも更新可能）
  async updatePayrollForCorrection(payroll: Partial<Payroll>) {
    if (!payroll.employeeId || !payroll.payrollId) {
      return false;
    }
    const result = await this.crudService.update<Payroll>(
      `${this.path}/${payroll.employeeId}/payroll/${payroll.payrollId}`,
      payroll
    );
    if (!result) {
      return false;
    }
    await this.getAllPayrollListForMonth(payroll.payrollId, true);
    return true;
  }

  //従業員1人分の給与・賞与データを取得
  async getPayrollListForEmployee(employeeId: string): Promise<Payroll[]> {
    return await this.crudService.getAll<Payroll>(`${this.path}/${employeeId}/payroll`, 'payrollId');
  }


  //日付をYYYY-MM-DDの形式に変換
  toDateInputValue(year: number, month: number, day: number): string {
    const lastDay = new Date(year, month, 0).getDate();
    //月末が31日じゃない場合、月末日に修正
    const safeDay = Math.min(day, lastDay);
    const date = new Date(year, month - 1, safeDay);
    const normalizedYear = date.getFullYear();
    const normalizedMonth = String(date.getMonth() + 1).padStart(2, '0');
    const normalizedDay = String(date.getDate()).padStart(2, '0');
    return `${normalizedYear}-${normalizedMonth}-${normalizedDay}`;
  }
}
