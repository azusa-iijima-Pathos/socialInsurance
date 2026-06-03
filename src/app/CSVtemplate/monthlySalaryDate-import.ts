
/**
 * 給与・勤務実績一括登録画面
 * ひな形ダウンロード用のCSVデータ
 */

// フォーマット1：給与内訳を入力するCSV一行分の型。
// 固定給・総支給額は取り込み時に内訳から計算するため、列として持たない。
export type EmployeeCsvRow1 = {
    employeeId: string;
    actualWorkingDays: string;
    actualWorkingHours: string;
    targetPeriodStart: string;
    targetPeriodEnd: string;
    paymentDate: string;
    basicSalary: string;
    fixedAllowance: string;
    transportAllowance: string;
    variableAllowance: string;
};

// フォーマット2：固定給と総支給額だけを直接入力するCSV一行分の型。
// 内訳を使わない会社設定向けなので、基本給・手当系の列は持たない。
export type EmployeeCsvRow2 = {
    employeeId: string;
    actualWorkingDays: string;
    actualWorkingHours: string;
    targetPeriodStart: string;
    targetPeriodEnd: string;
    paymentDate: string;
    fixedSalary: string;
    actualPaymentAmount: string;
};

// 各CSV列の定義。key は取り込み時の内部名、label はCSVヘッダー、example はひな形の例行に出す値。
export type EmployeeCsvColumn1 = {
    key: keyof EmployeeCsvRow1;
    label: string;
    example: string;
};

export type EmployeeCsvColumn2 = {
    key: keyof EmployeeCsvRow2;
    label: string;
    example: string;
};

// フォーマット1用のCSV列。会社設定が「項目別入力」の場合に使う。
export const EMPLOYEE_CSV_COLUMNS1: EmployeeCsvColumn1[] = [
    { key: 'employeeId', label: '社員ID（半角英数字）', example: 'E001' },
    { key: 'actualWorkingDays', label: '勤務日数（月単位）', example: '20' },
    { key: 'actualWorkingHours', label: '勤務時間（月単位）', example: '160' },
    { key: 'targetPeriodStart', label: '対象期間開始日（yyyy-mm-dd）', example: '2024-04-01' },
    { key: 'targetPeriodEnd', label: '対象期間終了日（yyyy-mm-dd）', example: '2024-04-30' },
    { key: 'paymentDate', label: '支給日（yyyy-mm-dd）', example: '2024-04-25' },
    { key: 'basicSalary', label: '基本給', example: '300000' },
    { key: 'fixedAllowance', label: '固定手当', example: '10000' },
    { key: 'transportAllowance', label: '通勤手当', example: '10000' },
    { key: 'variableAllowance', label: '変動手当', example: '30000' },
];

// フォーマット2用のCSV列。会社設定が「固定給と総支給額のみ入力」の場合に使う。
export const EMPLOYEE_CSV_COLUMNS2: EmployeeCsvColumn2[] = [
    { key: 'employeeId', label: '社員ID（半角英数字）', example: 'E001' },
    { key: 'actualWorkingDays', label: '勤務日数（月単位）', example: '20' },
    { key: 'actualWorkingHours', label: '勤務時間（月単位）', example: '160' },
    { key: 'targetPeriodStart', label: '対象期間開始日（yyyy-mm-dd）', example: '2024-04-01' },
    { key: 'targetPeriodEnd', label: '対象期間終了日（yyyy-mm-dd）', example: '2024-04-30' },
    { key: 'paymentDate', label: '支給日（yyyy-mm-dd）', example: '2024-04-25' },
    { key: 'fixedSalary', label: '固定給', example: '320000' },
    { key: 'actualPaymentAmount', label: '総支給額', example: '350000' },
];


export type SalaryInputFormat = 1 | 2;
type EmployeeCsvRowKey = keyof EmployeeCsvRow1 | keyof EmployeeCsvRow2;
type EmployeeCsvColumn = EmployeeCsvColumn1 | EmployeeCsvColumn2;

// 会社設定の入力フォーマットに合わせて、使うCSV列セットを切り替える。
// 以降の処理はこの関数経由で列を取得することで、フォーマット差分を一か所に閉じ込める。
function getEmployeeCsvColumns(inputFormat: SalaryInputFormat): EmployeeCsvColumn[] {
    return inputFormat === 1 ? EMPLOYEE_CSV_COLUMNS1 : EMPLOYEE_CSV_COLUMNS2;
}


// 選択されたフォーマットの列定義から、CSVヘッダー行だけを作る。
export function getEmployeeCsvHeaders(inputFormat: SalaryInputFormat): string[] {
    return getEmployeeCsvColumns(inputFormat).map(column => column.label);
}

// ExcelやCSV保存時に付くBOM・余白を除いて列名を比較する
export function normalizeCsvHeader(header: string): string {
    return header.replace(/^\uFEFF/, '').trim();
}

// ひな形の「例）」行に表示するサンプル値を、ヘッダー名をキーにしたオブジェクトで作る。
export function createEmployeeCsvTemplateRow(inputFormat: SalaryInputFormat): Record<string, string> {
    return getEmployeeCsvColumns(inputFormat).reduce<Record<string, string>>((row, column) => {
        row[column.label] = column.example;
        return row;
    }, {});
}

// 画面上で表形式プレビューが必要な場合に使える、ひな形全体の行データ。
// 現在のダウンロード処理では createEmployeeCsvTemplateCsv() を使う。
export function createEmployeeCsvTemplateRows(inputFormat: SalaryInputFormat): Record<string, string>[] {
    return [
        createEmployeeCsvGuideRow(inputFormat, '例）'),
        createEmployeeCsvTemplateRow(inputFormat),
        createEmployeeCsvGuideRow(inputFormat, '入力内容）'),
        createEmployeeCsvGuideRow(inputFormat, ''),
    ];
}

// ダウンロード用のCSV文字列を作る。
// 「ヘッダー → 例） → 例行 → 入力内容） → 空行」の順にして、ユーザーが下に追記しやすくする。
export function createEmployeeCsvTemplateCsv(inputFormat: SalaryInputFormat): string {
    const columns = getEmployeeCsvColumns(inputFormat);
    const headerLine = getEmployeeCsvHeaders(inputFormat).map(escapeCsvCell).join(',');
    const exampleLine = columns.map(column => escapeCsvCell(column.example)).join(',');

    return [
        headerLine,
        '例）',
        exampleLine,
        '入力内容）',
        '',
    ].join('\r\n');
}

// CSVの値にカンマ・改行・ダブルクォートが含まれる場合だけ、CSV仕様に合わせてダブルクォートで囲む。
function escapeCsvCell(value: string): string {
    if (!/[",\r\n]/.test(value)) return value;

    return `"${value.replace(/"/g, '""')}"`;
}

// 「例）」「入力内容）」などの案内行を作る。
// CSVとして列数を揃えるため、先頭列だけ文字を入れて他列は空文字にする。
export function createEmployeeCsvGuideRow(inputFormat: SalaryInputFormat, label: string): Record<string, string> {
    return getEmployeeCsvColumns(inputFormat).reduce<Record<string, string>>((row, column, index) => {
        row[column.label] = index === 0 ? label : '';
        return row;
    }, {});
}

// 取り込み時に、CSVのヘッダー名から内部キーに対応する値を取り出す。
// ヘッダー名は normalizeCsvHeader() でBOMや余白を除いて比較する。
export function getEmployeeCsvValue(row: Record<string, string>, key: EmployeeCsvRowKey, inputFormat: SalaryInputFormat): string {
    const column = getEmployeeCsvColumns(inputFormat).find(column => column.key === key);
    if (!column) return '';

    const value = Object.entries(row).find(([header]) => normalizeCsvHeader(header) === column.label)?.[1];
    return String(value ?? '').trim();
}

// 「入力内容）」行より下だけを取り込み対象にするための判定。
// 先頭列（社員ID列）に「入力内容）」が入っている行を開始位置として扱う。
export function isEmployeeCsvInputStartRow(row: Record<string, string>, inputFormat: SalaryInputFormat): boolean {
    return getEmployeeCsvValue(row, 'employeeId', inputFormat) === '入力内容）';
}