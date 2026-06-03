import { Timestamp } from "@angular/fire/firestore";
import { PayrollType } from "../constants/model-constants";

/**
* 給与・勤務実績
* companies/{companyId}/employees/{employeeId}/payroll/{payrollId}
*/
export type Payroll = {

    /** 給与・勤務実績ID（DocIdとして使用）{2026-01}か{2026-01_bonus}の形で登録 */
    payrollId: string;

    /** 会社ID（collectionGroup検索用） */
    companyId?: string;

    /** 社員ID（collectionGroup検索用） */
    employeeId?: string;

    /** タイプ */
    type?: PayrollType;

    /** 支給日 */
    paymentDate?: Timestamp;

    /** 実支給額 */
    actualPaymentAmount?: number;

    /** 該当期間 */
    targetPeriod?: Timestamp[];

    /** 固定給 */
    fixedSalary?: number;

    /** 勤務時間実績 （週単位）*/
    actualWorkingHours?: number;

    /** 勤務日数実績 （月単位）*/
    actualWorkingDays?: number;

    /** 作成日 */
    createdAt?: Timestamp;

    /** 更新日 */
    updatedAt?: Timestamp;
};
