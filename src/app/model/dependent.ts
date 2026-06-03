import { Timestamp } from "@angular/fire/firestore";
import {
    Relationship
} from "../constants/model-constants";

/**
* 現在の扶養情報
*/
export type Dependent = {

    /** 扶養者ID（DocIdとして使用） */
    dependentId: string;

    /** 扶養者名前 */
    name?: string;

    /** 生年月日 */
    birthDate?: Timestamp;

    /** 続柄 */
    relationship?: Relationship;

    /** ステータス */
    isDependent?: boolean;
}