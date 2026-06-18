import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { CrudService } from '../common/crud-service';
import { PayrollLock } from '../../model/payroll-lock';
import { PayrollType } from '../../constants/model-constants';

/**
 * 給与・賞与の確定ロックサービス
 */
@Injectable({
  providedIn: 'root',
})
export class PayrollLockService {

  private crudService = inject(CrudService);

  private get path() {
    const companyId = sessionStorage.getItem('companyId');
    return `companies/${companyId}/payrollLocks`;
  }

  async getPayrollLock(payrollId: string): Promise<PayrollLock | null> {
    return await this.crudService.getById<PayrollLock>(`${this.path}/${payrollId}`, 'payrollId');
  }

  async isPayrollLocked(payrollId: string): Promise<boolean> {
    const lock = await this.getPayrollLock(payrollId);
    return lock?.locked === true;
  }

  async getPayrollLocks(type?: PayrollType): Promise<PayrollLock[]> {
    const locks = await this.crudService.getAll<PayrollLock>(this.path, 'payrollId');
    return locks
      .filter(lock => !type || lock.type === type)
      .sort((a, b) => b.payrollId.localeCompare(a.payrollId));
  }

  async getLockedPayrolls(type?: PayrollType): Promise<PayrollLock[]> {
    return (await this.getPayrollLocks(type)).filter(lock => lock.locked);
  }

  async lockPayroll(payrollId: string, type: PayrollType): Promise<boolean> {
    return await this.crudService.create<PayrollLock>(
      `${this.path}/${payrollId}`,
      {
        payrollId,
        type,
        locked: true,
        lockedBy: sessionStorage.getItem('loginEmployeeId') ?? undefined,
        lockedAt: Timestamp.now(),
      }
    );
  }
}
