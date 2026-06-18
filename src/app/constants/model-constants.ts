import { Timestamp } from "@angular/fire/firestore";

/**
* 勤務状況
*/
export const WORK_STATUSES = ['通常勤務', '休職中', '退社済み', '退社予定' , '入社予定'] as const;
export type WorkStatus = typeof WORK_STATUSES[number];

/**
* 休業種別
*/
export const LEAVE_TYPES = ['産前産後', '育児', '療養', 'その他（有給）', 'その他（無給）'] as const;
export type LeaveType = typeof LEAVE_TYPES[number];

/**
* 雇用区分
*/
export const EMPLOYMENT_CATEGORIES = ['正社員', '契約社員', 'パート'] as const;
export type EmploymentCategory = typeof EMPLOYMENT_CATEGORIES[number];

/**
* 勤務形態
*/
export const WORK_STYLES = ['フルタイム', '時短', 'パート'] as const;
export type WorkStyle = typeof WORK_STYLES[number];

/**
* 性別
*/
export const GENDERS = ['男性', '女性'] as const;
export type Gender = typeof GENDERS[number];

/**
* 保険種別
*/
export const INSURANCE_TYPES = ['健康保険', '介護保険', '厚生年金'] as const;
export type InsuranceType = typeof INSURANCE_TYPES[number];

/**
* イベントタイプ
*/
export const EMPLOYEE_EVENT_TYPES = ['入社', '退社', '固定給変更', '雇用形態変更', '勤務状況変更', "扶養情報変更", '一定年齢到達', '氏名変更'] as const;
export type EmployeeEventType = typeof EMPLOYEE_EVENT_TYPES[number];

/**
* ライフイベントタイプ
*/
export const LIFE_EVENT_TYPES = ['入社', '退社', '結婚', '離婚', '出産', '育児', '雇用形態変更','その他'] as const;
export type LifeEventType = typeof LIFE_EVENT_TYPES[number];

/**
* 一定年齢到達タイプ
*/
export const REACH_AGE_TYPES = ['40歳', '65歳', '70歳', '75歳'] as const;
export type ReachAgeType = typeof REACH_AGE_TYPES[number];

/**
* 変更タイプ
*/
export const CHANGE_TYPES = ['変更','追加','削除','休職開始','休職終了'] as const;
export type ChangeType = typeof CHANGE_TYPES[number];

/**
* 申請者区分
*/
export const APPLICANT_TYPES = ['社員', '管理者', 'システム'] as const;
export type ApplicantType = typeof APPLICANT_TYPES[number];

/**
* 承認ステータス
*/
export const APPROVAL_STATUSES = ['申請中', '承認済み', '却下','適用済み'] as const;
export type ApprovalStatus = typeof APPROVAL_STATUSES[number];

/**
* 給与タイプ
*/
export const PAYROLL_TYPES = ['毎月', '賞与'] as const;
export type PayrollType = typeof PAYROLL_TYPES[number];

/**
* 続柄
*/
export const RELATIONSHIPS = ['配偶者', '子', '親', 'その他'] as const;
export type Relationship = typeof RELATIONSHIPS[number];

/**
* 同居・別居区分
*/
export const COHABITATION_TYPES = ['同居', '別居'] as const;
export type CohabitationType = typeof COHABITATION_TYPES[number];

/**
* 障害の有無
*/
export const DISABILITY_STATUSES = ['なし', 'あり'] as const;
export type DisabilityStatus = typeof DISABILITY_STATUSES[number];

/**
* 障害タイプ
*/
export const DISABILITY_TYPES = ['身体障害者', '精神障害者', '知的障害者'] as const;
export type DisabilityType = typeof DISABILITY_TYPES[number];

/**
* 学生区分
*/
export const STUDENT_STATUSES = ['学生じゃない', '学生'] as const;
export type StudentStatus = typeof STUDENT_STATUSES[number];

/**
* 学生タイプ
*/
export const STUDENT_TYPES = ['大学生', '専門学校生', '高校生', '中学生以下'] as const;
export type StudentType = typeof STUDENT_TYPES[number];

/**
* 計算タイプ
*/
export const CALCULATION_TYPES = ['資格取得', '資格喪失', '算定基礎', '随時改定', 'イベント', '賞与', '差額調整', 'その他'] as const;
export type CalculationType = typeof CALCULATION_TYPES[number];

/**
 * 届け出チェックリスト
 */
export const ANNOUNCEMENT_TYPES = ['保険変更', '産休育休', '扶養変更', '随時改定', '賞与保険', '算定基礎'] as const;
export type AnnouncementType = typeof ANNOUNCEMENT_TYPES[number];

export const ANNOUNCEMENT_SUB_TYPES = ['取得', '喪失', '変更'] as const;
export type AnnouncementSubType = typeof ANNOUNCEMENT_SUB_TYPES[number];

export const ANNOUNCEMENT_REASONS = ['入社', '退社', '雇用契約情報変更', '結婚', '離婚', '出産', '育児'] as const;
export type AnnouncementReason = typeof ANNOUNCEMENT_REASONS[number];

/**
* 権限（閲覧、申請、承認の権限管理）
*/
export const PERMISSIONS = ['閲覧', '申請', '承認', '管理'] as const;
export type Permission = typeof PERMISSIONS[number];

/**
* 事業種
*/
export const BUSINESS_TYPES = ['製造業', '建設業', '情報通信業', '運輸業', '卸売業', '小売業', '金融・保険業', '不動産業',
     '医療・福祉', '教育', 'サービス業（飲食・理美容・宿泊）', 'サービス業（その他）', '農業', '林業', '漁業', 'その他'] as const;
export type BusinessType = typeof BUSINESS_TYPES[number];

/**
* 都道府県
*/
export const PREFECTURES = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'] as const;
export type Prefecture = typeof PREFECTURES[number];

/**
* 承認情報
*/
export type Approval = {
    /** 承認ステータス */
    approvalStatus?: ApprovalStatus;

    /** 承認日 */
    approvedDate?: Timestamp;

    /** 承認者 */
    approvedBy?: string;

    /** 適用されたタイミングの作業月（YYYYMM形式の数値） */
    appliedFromMonth?: number;
};