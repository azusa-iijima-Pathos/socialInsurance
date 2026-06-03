import { Timestamp } from "@angular/fire/firestore";
import { Approval, CalculationType } from "../constants/model-constants";

/**
* システム計算結果
*/
export type CalculationRun = {

    /** 計算結果ID（DocIdとして使用） */
    runId: string;

    /** 対象者 */
    targetEmployeeIds?: string;

    /** 検出日 */
    detectedDate?: Timestamp;

    /** タイプ */
    type?: CalculationType;

    /** ペイロード */
    payload?: Record<string, any>;

    /** 承認情報 */
    approval?: Approval;

    /** 作成日 */
    createdAt?: Timestamp;

    /** 更新日 */
    updatedAt?: Timestamp;
};
