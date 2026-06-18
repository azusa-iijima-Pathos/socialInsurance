import { Timestamp } from "@angular/fire/firestore";
import { InsuranceType, PayrollType } from "../constants/model-constants";

/** 確定時点の保険加入状態 */
export type InsuranceEnrollmentStatus = 'joined' | 'notJoined' | 'lost';

/** 確定時点の各保険種別の加入状態 */
export type InsuranceEnrollmentStatuses = {
    healthInsurance?: InsuranceEnrollmentStatus;
    nursingCareInsurance?: InsuranceEnrollmentStatus;
    employeePensionInsurance?: InsuranceEnrollmentStatus;
};

/**
* 保険支払い情報
*/
export type InsuranceSnapshot = {

    /** 保険支払い情報ID（DocIdとして使用） */
    snapshotId: string;

    /** 会社ID */
    companyId?: string;

    /** 社員ID */
    employeeId?: string;

    /** 給与・勤務実績ID */
    payrollId?: string;

    /** タイプ */
    type?: PayrollType;

    /** 等級 */
    grade?: string;

    /** 確定時点の各保険種別の加入状態 */
    insuranceEnrollmentStatuses?: InsuranceEnrollmentStatuses;

    /** 各種支払い保険料 */
    insurancePayments?: InsurancePayment[];

    /** 作成日 */
    createdAt?: Timestamp;

    /** 更新日 */
    updatedAt?: Timestamp;
};

/**
* 保険料支払い明細
*/
export type InsurancePayment = {

    /** 保険種別 */
    insuranceType?: InsuranceType;

    /** 従業員負担 */
    employeeBurdenAmount?: number;

    /** 会社負担 */
    companyBurdenAmount?: number;
};
