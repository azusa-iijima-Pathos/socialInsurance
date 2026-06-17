import { Timestamp } from "@angular/fire/firestore";
import { ApplicantType, Approval, ChangeType, EmployeeEventType, LifeEventType, ReachAgeType } from "../constants/model-constants";

/**
* イベント
*/
export type Event = {

    /** イベントID（DocIdとして使用） */
    eventId: string

    /** 会社ID */
    companyId: string;

    /** 発生日 */
    occurredDate?: Timestamp;

    /** イベントタイプ */
    eventType?: EmployeeEventType;

    /** 変更タイプ（扶養情報変更（追加、削除、変更）、勤務状況変更（休職開始、休職終了）） */
    changeType?: ChangeType;

    /** 一定年齢到達タイプ */
    reachAgeType?: ReachAgeType;

    /** ライフイベントタイプ */
    lifeEventType?: LifeEventType;

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
