import { Timestamp } from "@angular/fire/firestore";
import { EmploymentCategory, InsuranceType, WorkStatus, WorkStyle } from "../constants/model-constants";
import { LeaveType } from "../constants/model-constants";

/**
* 社員情報
*/
export type Employee = {

    /** 社員ID（DocIdとして使用） */
    employeeId: string;

    /** 苗字 */
    firstName?: string;

    /** 名前 */
    lastName?: string;

    /** 生年月日 */
    birthDate?: Timestamp;

    /** 入社日 */
    hireDate?: Timestamp;

    /** 勤務状況 */
    workStatus?: WorkStatus;

    /** 休暇情報 */
    leaveTypes?: LeaveType;

    /** 退職日 */
    resignationDate?: Timestamp;

    /** 雇用契約情報 */
    employmentContract?: EmploymentContract;

    /** 保険情報 */
    insurance?: EmployeeInsurance;

    /** 作成日 */
    createdAt?: Timestamp;

    /** 更新日 */
    updatedAt?: Timestamp;
};

/**
* 雇用契約情報
*/
export type EmploymentContract = {

    /** 雇用区分 */
    employmentCategory?: EmploymentCategory;

    /** 勤務形態 */
    workStyle?: WorkStyle;

    /** 所属事業所ID */
    officeId?: string;

    /** 契約労働時間(週単位) */
    contractedWorkingHoursPerWeek?: number;

    /** 契約労働日数(月単位) */
    contractedWorkingDaysPerMonth?: number;

    /** 現在の固定給 */
    fixedSalary?: number;

    /** 交通費（契約社員の時短の場合とパートのときのみ、交通費基本給とは別で交通費を表示） */
    transportationExpenses?: number;
};

/**
* 社員の保険情報
*/
export type EmployeeInsurance = {

    /** 現在の等級 */
    currentGrade?: number;

    /** 健康保険 */
    healthInsurance?: InsuranceDetail;

    /** 介護保険 */
    nursingCareInsurance?: InsuranceDetail;

    /** 厚生年金 */
    employeePensionInsurance?: InsuranceDetail;
};

/**
* 保険詳細
*/
export type InsuranceDetail = {

    /** 加入有無 */
    joined?: boolean;

    /** 保険番号 */
    number?: string;

    /** 取得日 */
    acquiredDate?: Timestamp;

    /** 喪失日 */
    lostDate?: Timestamp;

    /** 会社負担率 */
    companyBurdenRate?: number;
};


/**
* 保険加入の判定
* 
* 正社員・フルタイム：加入
* 
* それ以外：
* 「週30時間以上」の場合強制加入（給与などは関係ない）
* 
*「特定適用事業所」「任意特定適用事業所」または「国・地方公共団体に属する事業所」に勤務する方で、
*1週間の所定労働時間または1月の所定労働日数が通常の労働者の4分の3未満である方のうち、
*以下の（1）から（3）のすべてに該当する方が短時間労働者として健康保険・厚生年金保険の加入対象となります。
*（1）週の所定労働時間が20時間以上であること
*（2）学生でないこと
*（3）所定内賃金が月額8.8万円以上であること（週給、日給、時間給を月額に換算したものに、各諸手当等を含めた所定内賃金の額が、8.8万円以上）
     時給×契約労働時間
*
*※2カ月以内の期間を定めて使用される方や臨時に使用される方等は健康保険・厚生年金保険の加入対象から除かれます
*
* 
* 週20時間以上で働く状況が２か月を超えて続くようであれば、加入対象となることがある
* 
* 
*/
