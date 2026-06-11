import { Timestamp } from "@angular/fire/firestore";
import { Prefecture } from "../constants/model-constants";

/**
* 事業所情報
*/
export type Office = {

    /** 事業所ID（DocIdとして使用） */
    officeId: string;

    /** 会社ID */
    companyId?: string;

    /** 名前 */
    name?: string;

    /** 住所(都道府県) */
    prefecture?: Prefecture;

    /** 事業所整理記号 */
    officeOrganizationSymbol?: string;

    /** 事業所番号 */
    officeNumber?: string;

    /** 削除フラグ */
    isDeleted?: boolean;

    /** 作成日 */
    createdAt?: Timestamp;

    /** 更新日 */
    updatedAt?: Timestamp;
};
