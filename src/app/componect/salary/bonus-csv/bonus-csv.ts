import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Timestamp } from '@angular/fire/firestore';
import Papa from 'papaparse';
import { Payroll } from '../../../model/payroll';
import { PayrollService } from '../../../service/Firestore/payroll-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { CorrectionLogicService } from '../../../service/logic/correction-logic.service';

type BonusCsvPreviewRow = {
  rowNumber: number;
  selected: boolean;
  canRegister: boolean;
  errors: string[];
  employeeId: string;
  targetPeriodStart: string;
  targetPeriodEnd: string;
  paymentDate: string;
  actualPaymentAmount?: number;
  payroll?: Partial<Payroll>;
};

@Component({
  selector: 'app-bonus-csv',
  imports: [CommonModule],
  templateUrl: './bonus-csv.html',
  styleUrl: './bonus-csv.css',
})
export class BonusCsv {

  @Input() payrollId = '';
  @Input() disabled = false;
  @Output() payrollRegistered = new EventEmitter<void>();

  private payrollService = inject(PayrollService);
  private commonService = inject(CommonService);
  private employeeService = inject(EmployeeService);
  private correctionLogicService = inject(CorrectionLogicService);

  companyId = sessionStorage.getItem('companyId');
  selectedCsvFile: File | null = null;
  selectedCsvFileName = '';
  csvImportMessage = '';
  csvMessageTimer: MessageTimer = null;
  csvPreviewRows: BonusCsvPreviewRow[] = [];
  csvPreviewModalOpen = false;
  private csvDataRowNumberOffset = 2;

  // CSVプレビュー内で選択されている登録可能行の件数を返す
  selectedCsvPreviewCount() {
    return this.csvPreviewRows.filter(row => row.selected && row.canRegister).length;
  }

  // 賞与CSVの入力テンプレートをダウンロードする
  downloadCsvTemplate() {
    const csv = [
      '社員ID（半角英数字）,対象期間開始日（yyyy-mm-dd）,対象期間終了日（yyyy-mm-dd）,支給日（yyyy-mm-dd）,賞与支給額',
      'E001,2026-01-01,2026-01-31,2026-01-25,300000',
      '入力内容）',
      '',
    ].join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'bonus-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  // 選択されたCSVファイルを保持し、前回のプレビュー状態をリセットする
  onCsvFileSelected(event: Event) {
    if (this.disabled) {
      this.setCsvImportStatus('保険料確定済みのため、賞与情報は編集できません');
      return;
    }
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    this.csvPreviewRows = [];
    this.csvPreviewModalOpen = false;
    this.selectedCsvFile = file;
    this.selectedCsvFileName = file?.name ?? '';
    this.setCsvImportStatus(file ? '' : 'CSVファイルが選択されていません');
  }

  // CSVファイルを読み取り、登録前の確認用プレビューを作成する
  async importCsv() {
    if (this.disabled) {
      this.setCsvImportStatus('保険料確定済みのため、賞与情報は編集できません');
      return;
    }
    if (!this.selectedCsvFile) {
      this.setCsvImportStatus('CSVファイルを選択してください');
      return;
    }
    if (!this.payrollId) {
      this.setCsvImportStatus('賞与IDが指定されていません');
      return;
    }

    this.csvPreviewRows = [];
    this.csvPreviewModalOpen = false;
    this.setCsvImportStatus('CSV内容を確認中です');
    try {
      const result = await this.previewCsv(this.selectedCsvFile);
      this.csvPreviewRows = result.rows;
      this.csvPreviewModalOpen = result.rows.length > 0;
      this.setCsvImportStatus(result.message);
    } catch (error) {
      console.error(error);
      this.setCsvImportStatus('CSV内容の確認に失敗しました');
    }
  }

  // プレビューで選択された賞与行だけをPayrollへ登録する
  async registerSelectedCsvRows() {
    if (this.disabled) {
      this.setCsvImportStatus('保険料確定済みのため、賞与情報は編集できません');
      return;
    }
    const selectedRows = this.csvPreviewRows.filter(row => row.selected && row.canRegister && row.payroll);
    if (!selectedRows.length) {
      this.setCsvImportStatus('登録対象の行を選択してください');
      return;
    }

    let successCount = 0;
    for (const row of selectedRows) {
      const result = await this.payrollService.registerPayroll(row.employeeId, row.payroll!);
      if (result) successCount++;
    }

    await this.payrollService.getAllPayrollListForMonth(this.payrollId, true);
    this.csvPreviewModalOpen = false;
    this.setCsvImportStatus(`CSV取り込みが完了しました：${successCount} 件`);
    if (successCount > 0) {
      this.payrollRegistered.emit();
    }
  }

  // プレビュー行のチェック状態を更新する
  setCsvPreviewRowSelected(row: BonusCsvPreviewRow, checked: boolean) {
    row.selected = checked;
  }

  // 登録可能なプレビュー行をすべて選択する
  selectAllCsvPreviewRows() {
    this.csvPreviewRows.forEach(row => {
      if (row.canRegister) row.selected = true;
    });
  }

  // プレビュー行の選択をすべて解除する
  clearAllCsvPreviewRows() {
    this.csvPreviewRows.forEach(row => row.selected = false);
  }

  // CSVプレビューモーダルを閉じる
  closeCsvPreviewModal() {
    this.csvPreviewModalOpen = false;
  }

  // CSVの各行を検証し、登録可能なPayrollデータと行ごとのエラーを作る
  private async previewCsv(file: File): Promise<{ message: string; rows: BonusCsvPreviewRow[] }> {
    const result = await this.parseCsv(file);
    const rowInfos = result.data.map((row, index) => ({ row: this.normalizeCsvRow(row), rowNumber: index + this.csvDataRowNumberOffset }));
    const csvHeaders = (result.meta.fields ?? []).map(header => this.normalizeCsvHeader(header));
    if (!this.hasValidHeaders(csvHeaders)) {
      return this.createCsvPreviewErrorRows(result, 'CSVの列がひな形と一致していません');
    }

    const inputStartIndex = rowInfos.findIndex(rowInfo => this.isInputGuideRow(rowInfo.row));
    const parseErrorMap = this.createParseErrorMap(result.errors, inputStartIndex);
    const rows = (inputStartIndex >= 0 ? rowInfos.slice(inputStartIndex + 1) : rowInfos)
      .filter(rowInfo => !this.isInputGuideRow(rowInfo.row))
      .filter(rowInfo => Object.values(rowInfo.row).some(value => String(value ?? '').trim()));

    if (!rows.length) {
      return {
        message: 'CSVに取り込み対象のデータがありません',
        rows: [],
      };
    }

    let employeeIds: string[] = [];
    let employeeCheckFailed = false;
    try {
      await this.employeeService.getAllEmployees();
      employeeIds = this.employeeService.allEmployeeIDs();
    } catch (error) {
      console.error(error);
      employeeCheckFailed = true;
    }

    const previewRows: BonusCsvPreviewRow[] = [];
    for (const { row, rowNumber } of rows) {
      const errors: string[] = [...(parseErrorMap.get(rowNumber) ?? [])];
      let employeeId = '';
      let targetPeriodStartText = '';
      let targetPeriodEndText = '';
      let paymentDateText = '';
      let amountText = '';
      let actualPaymentAmount: number | null = null;
      let targetPeriodStart: Timestamp | null = null;
      let targetPeriodEnd: Timestamp | null = null;
      let paymentDate: Timestamp | null = null;
      let payroll: Partial<Payroll> | undefined = undefined;

      try {
        if (Object.values(row).some(value => /[^\x00-\x7F]/.test(String(value ?? '')))) {
          errors.push(`${rowNumber}行目：半角で入力してください`);
        }
        employeeId = this.getCsvValue(row, 'employeeId');
        targetPeriodStartText = this.getCsvValue(row, 'targetPeriodStart');
        targetPeriodEndText = this.getCsvValue(row, 'targetPeriodEnd');
        paymentDateText = this.getCsvValue(row, 'paymentDate');
        amountText = this.getCsvValue(row, 'actualPaymentAmount');
        actualPaymentAmount = this.toNumber(amountText);
        targetPeriodStart = this.toTimestamp(targetPeriodStartText);
        targetPeriodEnd = this.toTimestamp(targetPeriodEndText);
        paymentDate = this.toTimestamp(paymentDateText);

        if (!employeeId) errors.push(`${rowNumber}行目：社員IDが未入力です`);
        if (employeeId && !/^[a-zA-Z0-9]+$/.test(employeeId)) errors.push(`${rowNumber}行目：社員IDは半角英数字で入力してください`);
        if (employeeId && /^[a-zA-Z0-9]+$/.test(employeeId) && employeeCheckFailed) errors.push(`${rowNumber}行目：社員IDの確認に失敗しました`);
        if (employeeId && /^[a-zA-Z0-9]+$/.test(employeeId) && !employeeCheckFailed && !employeeIds.includes(employeeId)) errors.push(`${rowNumber}行目：社員IDが存在しません`);
        if (!targetPeriodStartText) errors.push(`${rowNumber}行目：対象期間開始日が未入力です`);
        if (!targetPeriodEndText) errors.push(`${rowNumber}行目：対象期間終了日が未入力です`);
        if (!paymentDateText) errors.push(`${rowNumber}行目：支給日が未入力です`);
        if (!amountText) errors.push(`${rowNumber}行目：賞与支給額が未入力です`);
        if (amountText && actualPaymentAmount === null) errors.push(`${rowNumber}行目：賞与支給額は数値で入力してください`);
        if (actualPaymentAmount !== null && actualPaymentAmount <= 0) errors.push(`${rowNumber}行目：賞与支給額は1円以上で入力してください`);
        if (targetPeriodStartText && !targetPeriodStart) errors.push(`${rowNumber}行目：対象期間開始日の日付形式が正しくありません`);
        if (targetPeriodEndText && !targetPeriodEnd) errors.push(`${rowNumber}行目：対象期間終了日の日付形式が正しくありません`);
        if (paymentDateText && !paymentDate) errors.push(`${rowNumber}行目：支給日の日付形式が正しくありません`);
        if (paymentDateText && paymentDate && !this.isPaymentDateMatchedPayrollId(paymentDateText)) {
          errors.push(`${rowNumber}行目：支給日は ${this.payrollId.replace('_bonus', '')} の月で入力してください`);
        }

        payroll = errors.length || !targetPeriodStart || !targetPeriodEnd || !paymentDate || actualPaymentAmount === null ? undefined : {
          type: '賞与' as const,
          companyId: this.companyId!,
          payrollId: this.payrollId,
          targetPeriod: [targetPeriodStart, targetPeriodEnd],
          paymentDate,
          actualPaymentAmount,
        };
      } catch (error) {
        console.error(error);
        errors.push(`${rowNumber}行目：CSVデータの確認中にエラーが発生しました`);
      }

      if (employeeId && payroll) {
        try {
          const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
          const enrollmentError = await this.correctionLogicService.validatePayrollEnrollment(employee, this.payrollId);
          if (enrollmentError) {
            errors.push(`${rowNumber}行目：${enrollmentError}`);
          }
          const existingPayroll = await this.payrollService.getPayroll(employeeId, payroll);
          if (existingPayroll) errors.push(`${rowNumber}行目：社員ID ${employeeId} の同じ支給月の賞与は既に登録済みです`);
        } catch (error) {
          console.error(error);
          errors.push(`${rowNumber}行目：登録済み賞与の確認に失敗しました`);
        }
      }

      previewRows.push({
        rowNumber,
        selected: errors.length === 0,
        canRegister: errors.length === 0,
        errors,
        employeeId,
        targetPeriodStart: targetPeriodStartText,
        targetPeriodEnd: targetPeriodEndText,
        paymentDate: paymentDateText,
        actualPaymentAmount: actualPaymentAmount ?? undefined,
        payroll: errors.length === 0 ? payroll : undefined,
      });
    }

    const errorCount = previewRows.filter(row => row.errors.length > 0).length;
    return { message: `CSV確認完了：登録可能 ${previewRows.length - errorCount} 件、エラー ${errorCount} 件`, rows: previewRows };
  }

  // PapaParseでCSVファイルをヘッダー付きの行データに変換する
  private parseCsv(file: File): Promise<Papa.ParseResult<Record<string, string>>> {
    return new Promise(async (resolve, reject) => {
      try {
        const text = await file.text();
        const csvText = this.createImportCsvText(text);
        Papa.parse<Record<string, string>>(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: result => resolve(result),
          error: (error: Error) => reject(error),
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private createImportCsvText(text: string) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
    const headerLine = lines[0] ?? '';
    const inputStartIndex = lines.findIndex(line => line.trim() === '入力内容）');
    if (inputStartIndex < 0) {
      this.csvDataRowNumberOffset = 2;
      return text;
    }

    this.csvDataRowNumberOffset = inputStartIndex + 2;
    return [headerLine, ...lines.slice(inputStartIndex + 1)].join('\r\n');
  }

  // PapaParseの列数エラーを、全体エラーではなく行ごとのエラーに変換する
  private createParseErrorMap(errors: Papa.ParseError[], inputStartIndex: number) {
    const parseErrorMap = new Map<number, string[]>();
    for (const error of errors) {
      if (error.row === undefined) continue;

      const rowNumber = error.row + this.csvDataRowNumberOffset;
      const dataIndex = error.row;
      if (inputStartIndex >= 0 && dataIndex <= inputStartIndex) continue;

      const messages = parseErrorMap.get(rowNumber) ?? [];
      messages.push(`${rowNumber}行目：未入力の項目があります`);
      parseErrorMap.set(rowNumber, messages);
    }
    return parseErrorMap;
  }

  // CSVヘッダー名に対応する値を取得し、前後の空白を取り除く
  private getCsvValue(row: Record<string, string>, key: 'employeeId' | 'targetPeriodStart' | 'targetPeriodEnd' | 'paymentDate' | 'actualPaymentAmount') {
    const labels = {
      employeeId: '社員ID（半角英数字）',
      targetPeriodStart: '対象期間開始日（yyyy-mm-dd）',
      targetPeriodEnd: '対象期間終了日（yyyy-mm-dd）',
      paymentDate: '支給日（yyyy-mm-dd）',
      actualPaymentAmount: '賞与支給額',
    };
    const value = Object.entries(row).find(([header]) => this.normalizeCsvHeader(header) === labels[key])?.[1];
    return String(value ?? '').trim();
  }

  private normalizeCsvHeader(header: string | null | undefined): string {
    return String(header ?? '').replace(/^\uFEFF/, '').trim();
  }

  private hasValidHeaders(csvHeaders: string[]) {
    const expectedHeaders = [
      '社員ID（半角英数字）',
      '対象期間開始日（yyyy-mm-dd）',
      '対象期間終了日（yyyy-mm-dd）',
      '支給日（yyyy-mm-dd）',
      '賞与支給額',
    ];
    return expectedHeaders.every(header => csvHeaders.includes(header));
  }

  private normalizeCsvRow(row: Record<string, string> | null | undefined): Record<string, string> {
    return row && typeof row === 'object' ? row : {};
  }

  private createCsvPreviewErrorRows(
    result: Papa.ParseResult<Record<string, string>>,
    message: string,
  ): { message: string; rows: BonusCsvPreviewRow[] } {
    const rows = result.data
      .map((row, index) => ({ row: this.normalizeCsvRow(row), rowNumber: index + this.csvDataRowNumberOffset }))
      .filter(rowInfo => !this.isInputGuideRow(rowInfo.row))
      .filter(rowInfo => Object.values(rowInfo.row).some(value => String(value ?? '').trim()))
      .map(rowInfo => ({
        rowNumber: rowInfo.rowNumber,
        selected: false,
        canRegister: false,
        errors: [`${rowInfo.rowNumber}行目：${message}`],
        employeeId: this.getCsvValue(rowInfo.row, 'employeeId'),
        targetPeriodStart: this.getCsvValue(rowInfo.row, 'targetPeriodStart'),
        targetPeriodEnd: this.getCsvValue(rowInfo.row, 'targetPeriodEnd'),
        paymentDate: this.getCsvValue(rowInfo.row, 'paymentDate'),
        actualPaymentAmount: this.toNumber(this.getCsvValue(rowInfo.row, 'actualPaymentAmount')) ?? undefined,
      }));

    return {
      message: `CSV確認完了：登録可能 0 件、エラー ${rows.length} 件`,
      rows,
    };
  }

  // テンプレート内の「入力内容）」案内行は登録対象から除外する
  private isInputGuideRow(row: Record<string, string>) {
    return Object.values(row).some(value => {
      const normalizedValue = String(value ?? '').trim().replace(/,+$/, '');
      return normalizedValue === '入力内容）';
    });
  }

  // CSVの支給日が、トップから渡された賞与IDの年月と一致するか確認する
  private isPaymentDateMatchedPayrollId(paymentDate: string) {
    const expectedPaymentMonth = this.payrollId.replace('_bonus', '');
    const inputPaymentMonth = paymentDate.replace(/\//g, '-').slice(0, 7);
    return inputPaymentMonth === expectedPaymentMonth;
  }

  // CSVの日付文字列をFirestore Timestampに変換する
  private toTimestamp(value: string): Timestamp | null {
    if (!value) return null;
    const normalizedValue = value.replace(/\//g, '-');
    const match = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null;
    }
    return Timestamp.fromDate(date);
  }

  // CSVの数値文字列をnumberに変換する
  private toNumber(value: string): number | null {
    if (!value) return null;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  // CSV取り込みの状態メッセージを一定時間表示する
  private setCsvImportStatus(message: string) {
    this.csvMessageTimer = this.commonService.showTimedMessage(message, value => this.csvImportMessage = value, this.csvMessageTimer);
  }
}
