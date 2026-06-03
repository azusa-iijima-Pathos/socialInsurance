import { Timestamp } from "@angular/fire/firestore";
import { ApplicantType, Approval, EmployeeEventType, ReachAgeType } from "../constants/model-constants";

/**
* イベント
*/
export type Event = {

    /** イベントID（DocIdとして使用） */
    eventId: string

    /** 会社IDID */
    companyId: string;

    /** 発生日 */
    occurredDate?: Timestamp;

    /** イベントタイプ */
    eventType?: EmployeeEventType;

    /** 一定年齢到達タイプ */
    reachAgeType?: ReachAgeType;

    /** 申請日 */
    appliedDate?: Timestamp;

    /** 申請者 */
    applicantType?: ApplicantType;

    /** 承認情報 */ 
    approval?: Approval;

    /** ペイロード */
    payload?: Record<string, any>;

    /** 作成日 */
    createdAt?: Timestamp;

    /** 更新日 */
    updatedAt?: Timestamp;
};
