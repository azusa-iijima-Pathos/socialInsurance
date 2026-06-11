import { WorkStatus, EmploymentCategory, WorkStyle, LeaveType, Gender } from '../constants/model-constants';

/**
 * 社員情報初期登録画面（個別登録、CSV一括登録）
 * ひな形ダウンロード用のCSVデータ
 */

//CSV一行のデータ
export type EmployeeCsvRow = {
    employeeId: string;
    firstName: string;
    lastName: string;
    birthDate: string;
    gender: string;
    hireDate: string;
    workStatus: WorkStatus;
    leaveTypes: LeaveType;
    employmentCategory: EmploymentCategory;
    workStyle: WorkStyle;
    officeId: string;
    contractedWorkingHoursPerWeek: string;
    contractedWorkingDaysPerMonth: string;
    fixedSalary: string;
    transportationExpenses: string;
};

export type EmployeeCsvColumn = {
    key: keyof EmployeeCsvRow;
    label: string;
    example: string;
};

//ひな形のCSV列
export const EMPLOYEE_CSV_COLUMNS: EmployeeCsvColumn[] = [
    { key: 'employeeId', label: '社員ID（半角英数字）', example: 'E001' },
    { key: 'firstName', label: '姓', example: '山田' },
    { key: 'lastName', label: '名', example: '太郎' },
    { key: 'birthDate', label: '生年月日（yyyy-mm-dd）', example: '1990-01-01' },
    { key: 'gender', label: '性別（男性/女性）', example: '男性' },
    { key: 'hireDate', label: '入社日（yyyy-mm-dd）', example: '2024-04-01' },
    { key: 'workStatus', label: '勤務状況（通常勤務/休職中/退社済み）', example: '通常勤務' },
    { key: 'leaveTypes', label: '休暇種別（なし/産前産後/育児/療養/その他（有給）/その他（無給））', example: 'なし' },
    { key: 'employmentCategory', label: '雇用区分（正社員/契約社員/パート）', example: '正社員' },
    { key: 'workStyle', label: '勤務形態（フルタイム/時短/パート）', example: 'フルタイム' },
    { key: 'officeId', label: '事業所名', example: '本社' },
    { key: 'contractedWorkingHoursPerWeek', label: '契約労働時間（週単位）', example: '40' },
    { key: 'contractedWorkingDaysPerMonth', label: '契約労働日数（月単位）', example: '20' },
    { key: 'fixedSalary', label: '現在の固定給', example: '300000' },
    { key: 'transportationExpenses', label: '通勤手当', example: '10000' },
];

//ひな形のCSVヘッダー
export const EMPLOYEE_CSV_HEADERS = EMPLOYEE_CSV_COLUMNS.map(column => column.label);

// ExcelやCSV保存時に付くBOM・余白を除いて列名を比較する
export function normalizeCsvHeader(header: string | null | undefined): string {
    return String(header ?? '').replace(/^\uFEFF/, '').trim();
}

//ひな形のCSV例
export function createEmployeeCsvTemplateRow(): Record<string, string> {
    return EMPLOYEE_CSV_COLUMNS.reduce<Record<string, string>>((row, column) => {
        row[column.label] = column.example;
        return row;
    }, {});
}

//ひな形のCSV全体
export function createEmployeeCsvTemplateRows(): Record<string, string>[] {
    return [
        createEmployeeCsvGuideRow('例）'),
        createEmployeeCsvTemplateRow(),
        createEmployeeCsvGuideRow('入力内容）'),
        createEmployeeCsvGuideRow(''),
    ];
}

//ひな形のCSV文字列
export function createEmployeeCsvTemplateCsv(): string {
    const headerLine = EMPLOYEE_CSV_HEADERS.map(escapeCsvCell).join(',');
    const exampleLine = EMPLOYEE_CSV_COLUMNS.map(column => escapeCsvCell(column.example)).join(',');

    return [
        headerLine,
        '例）',
        exampleLine,
        '入力内容）',
        '',
    ].join('\r\n');
}

function escapeCsvCell(value: string): string {
    if (!/[",\r\n]/.test(value)) return value;

    return `"${value.replace(/"/g, '""')}"`;
}

//案内用の行は先頭列だけに文字を入れる
export function createEmployeeCsvGuideRow(label: string): Record<string, string> {
    return EMPLOYEE_CSV_COLUMNS.reduce<Record<string, string>>((row, column, index) => {
        row[column.label] = index === 0 ? label : '';
        return row;
    }, {});
}

//ひな形のCSV値取得
export function getEmployeeCsvValue(row: Record<string, string>, key: keyof EmployeeCsvRow): string {
    const column = EMPLOYEE_CSV_COLUMNS.find(column => column.key === key);
    if (!column) return '';

    const value = Object.entries(row).find(([header]) => normalizeCsvHeader(header) === column.label)?.[1];
    return String(value ?? '').trim();
}

//「入力内容）」行より下だけを取り込み対象にするための判定
export function isEmployeeCsvInputStartRow(row: Record<string, string>): boolean {
    return getEmployeeCsvValue(row, 'employeeId') === '入力内容）';
}