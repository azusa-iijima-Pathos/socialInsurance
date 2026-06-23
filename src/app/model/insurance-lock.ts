import { Timestamp } from '@angular/fire/firestore';
import { PayrollType } from '../constants/model-constants';

/**
 * 保険料の確定ロック
 * PATH: companies/{companyId}/insuranceLocks/{payrollId}
 */
export type InsuranceLock = {
  payrollId: string;
  type: PayrollType;
  locked: boolean;
  lockedBy?: string;
  lockedAt?: Timestamp;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};
