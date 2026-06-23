import { Injectable, inject, signal } from '@angular/core';
import { CrudService } from '../common/crud-service';
import { Payroll } from '../../model/payroll';
import { PayrollLockService } from './payroll-lock-service';
import { CREATE_MESSAGES } from '../../constants/constants';

/**
 * 給与・勤務実績サービス
 */
//PATH: companies/{companyId}/employees/{employeeId}/payroll/{payrollId}

export type PayrollRegisterResult =
  | { ok: true }
  | { ok: false; reason: 'locked' | 'duplicate' | 'invalid' | 'storage' };

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

  getRegisterErrorMessage(result: Extract<PayrollRegisterResult, { ok: false }>): string {
    switch (result.reason) {
      case 'locked':
        return '対象月は確定済みのため、新規登録できません。給与修正画面から登録してください。';
      case 'duplicate':
        return '同じ対象月の給与・勤務実績は既に登録済みです';
      case 'invalid':
        return '登録データが不正です。数値や日付を確認してください。';
      case 'storage':
        return CREATE_MESSAGES.FAILED;
    }
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

  private toPayrollNumber(value: unknown): number {
    if (value === null || value === undefined || value === '') {
      return 0;
    }
    const num = Number(value);
    if (!Number.isFinite(num)) {
      throw new Error('Invalid payroll number');
    }
    return num;
  }

  private buildPayrollPayload(
    employeeId: string,
    payroll: Partial<Payroll>,
    payrollId: string,
  ): Partial<Payroll> | null {
    const companyId = this.companyId;
    if (!companyId) {
      return null;
    }

    const payload: Partial<Payroll> = {
      ...payroll,
      payrollId,
      employeeId,
      companyId,
    };

    if (payroll.type !== '賞与') {
      payload.actualWorkingDays = this.toPayrollNumber(payroll.actualWorkingDays);
      payload.actualWorkingHours = this.toPayrollNumber(payroll.actualWorkingHours);
      payload.fixedSalary = this.toPayrollNumber(payroll.fixedSalary);
    }

    if (payroll.actualPaymentAmount !== undefined && payroll.actualPaymentAmount !== null) {
      payload.actualPaymentAmount = this.toPayrollNumber(payroll.actualPaymentAmount);
    }

    return payload;
  }

  //給与・勤務実績を1件取得（すでにデータがあるか確認用）
  async getPayroll(employeeId: string, payroll: Partial<Payroll>): Promise<Payroll | null> {
    const payrollId = this.createPayrollId(payroll);
    return await this.crudService.getById<Payroll>(`${this.path}/${employeeId}/payroll/${payrollId}`, 'payrollId');
  }

  //新規作成
  async registerPayroll(employeeId: string, payroll: Partial<Payroll>): Promise<PayrollRegisterResult> {
    try {
      const payrollId = this.createPayrollId(payroll);
      if (await this.payrollLockService.isPayrollLocked(payrollId)) {
        return { ok: false, reason: 'locked' };
      }
      const existingPayroll = await this.getPayroll(employeeId, payroll);
      if (existingPayroll) {
        return { ok: false, reason: 'duplicate' };
      }

      const payload = this.buildPayrollPayload(employeeId, payroll, payrollId);
      if (!payload) {
        return { ok: false, reason: 'invalid' };
      }

      const created = await this.crudService.create<Payroll>(
        `${this.path}/${employeeId}/payroll/${payrollId}`,
        payload,
      );
      if (!created) {
        return { ok: false, reason: 'storage' };
      }
      return { ok: true };
    } catch (error) {
      console.error(error);
      return { ok: false, reason: 'invalid' };
    }
  }

  /** 確定済み月の給与修正用新規登録（ロック済みでも登録可能） */
  async registerPayrollForCorrection(employeeId: string, payroll: Partial<Payroll>): Promise<PayrollRegisterResult> {
    try {
      const payrollId = this.createPayrollId(payroll);
      const existingPayroll = await this.getPayroll(employeeId, payroll);
      if (existingPayroll) {
        return { ok: false, reason: 'duplicate' };
      }

      const payload = this.buildPayrollPayload(employeeId, payroll, payrollId);
      if (!payload) {
        return { ok: false, reason: 'invalid' };
      }

      const created = await this.crudService.create<Payroll>(
        `${this.path}/${employeeId}/payroll/${payrollId}`,
        payload,
      );
      if (!created) {
        return { ok: false, reason: 'storage' };
      }
      await this.getAllPayrollListForMonth(payrollId, true);
      return { ok: true };
    } catch (error) {
      console.error(error);
      return { ok: false, reason: 'invalid' };
    }
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
