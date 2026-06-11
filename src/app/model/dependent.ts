import { Timestamp } from "@angular/fire/firestore";
import {
    Relationship,
    CohabitationType,
    DisabilityType,
    StudentType,
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

    /** 同居・別居区分 */
    cohabitationType?: CohabitationType;

    /** 収入額（年収見込み） */
    annualIncome?: number;

    /** 職業 */
    occupation?: string;

    /** 障害あり */
    hasDisability?: boolean;

    /** 障害タイプ（障害ありの場合必須） */
    disabilityType?: DisabilityType;

    /** 学生 */
    isStudent?: boolean;

    /** 学生タイプ（学生の場合必須） */
    studentType?: StudentType;
}