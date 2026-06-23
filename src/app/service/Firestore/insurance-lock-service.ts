import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { CrudService } from '../common/crud-service';
import { InsuranceLock } from '../../model/insurance-lock';
import { PayrollType } from '../../constants/model-constants';

/**
 * 保険料の確定ロックサービス
 */
@Injectable({
  providedIn: 'root',
})
export class InsuranceLockService {

  private crudService = inject(CrudService);

  private get path() {
    const companyId = sessionStorage.getItem('companyId');
    return `companies/${companyId}/insuranceLocks`;
  }

  async getInsuranceLock(payrollId: string): Promise<InsuranceLock | null> {
    return await this.crudService.getById<InsuranceLock>(`${this.path}/${payrollId}`, 'payrollId');
  }

  async isInsuranceLocked(payrollId: string): Promise<boolean> {
    const lock = await this.getInsuranceLock(payrollId);
    return lock?.locked === true;
  }

  async getInsuranceLocks(type?: PayrollType): Promise<InsuranceLock[]> {
    const locks = await this.crudService.getAll<InsuranceLock>(this.path, 'payrollId');
    return locks
      .filter(lock => !type || lock.type === type)
      .sort((left, right) => right.payrollId.localeCompare(left.payrollId));
  }

  async lockInsurance(payrollId: string, type: PayrollType): Promise<boolean> {
    return await this.crudService.create<InsuranceLock>(
      `${this.path}/${payrollId}`,
      {
        payrollId,
        type,
        locked: true,
        lockedBy: sessionStorage.getItem('loginEmployeeId') ?? undefined,
        lockedAt: Timestamp.now(),
      },
    );
  }

  /** 未確定なら保険料をロックする（確定済みなら true を返す） */
  async ensureInsuranceLocked(payrollId: string, type: PayrollType): Promise<boolean> {
    if (await this.isInsuranceLocked(payrollId)) {
      return true;
    }
    return await this.lockInsurance(payrollId, type);
  }
}
