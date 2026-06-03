import { Timestamp } from '@angular/fire/firestore';
import { PayrollType } from '../constants/model-constants';

/**
 * 給与・賞与の確定ロック
 * PATH: companies/{companyId}/payrollLocks/{payrollId}
 */
export type PayrollLock = {
    payrollId: string;
    type: PayrollType;
    locked: boolean;
    lockedBy?: string;
    lockedAt?: Timestamp;
    createdAt?: Timestamp;
    updatedAt?: Timestamp;
};
