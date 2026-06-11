import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import Papa from 'papaparse';
import {
  getEmployeeCsvHeaders,
  getEmployeeCsvValue,
  isEmployeeCsvInputStartRow,
  normalizeCsvHeader,
  SalaryInputFormat,
} from '../../CSVtemplate/monthlySalaryDate-import';
import { Payroll } from '../../model/payroll';
import { CompanyService } from '../Firestore/company-service';
import { EmployeeService } from '../Firestore/employee-service';
import { PayrollService } from '../Firestore/payroll-service';

export type CsvMonthlySalaryPreviewRow = {
  rowNumber: number;
  selected: boolean;
  canRegister: boolean;
  errors: string[];
  payroll?: Partial<Payroll>;
  employeeId: string;
  actualWorkingDays?: number;
  actualWorkingHours?: number;
  paymentDate: string;
  targetPeriodStart: string;
  targetPeriodEnd: string;
  fixedSalary?: number;
  actualPaymentAmount?: number;
};

export type CsvMonthlySalaryPreviewResult = {
  message: string;
  errors: string[];
  rows: CsvMonthlySalaryPreviewRow[];
};

export type CsvMonthlySalaryImportResult = {
  message: string;
  errors: string[];
};

@Injectable({
  providedIn: 'root',
})
export class AddMonthlySalaryByCSVService {

  private companyService = inject(CompanyService);
  private employeeService = inject(EmployeeService);
  private payrollService = inject(PayrollService);

  private get companyId(): string | null {
    return sessionStorage.getItem('companyId');
  }

  // CSVを読み込んで、画面に出す確認用データを作る。
  // この時点ではFirestore登録はせず、CSVの列・社員ID・日付・金額・重複だけをチェックする。
  async previewCsv(file: File, inputFormat: SalaryInputFormat, payrollId: string): Promise<CsvMonthlySalaryPreviewResult> {
    let result: Papa.ParseResult<Record<string, string>>;
    try {
      result = await this.parseCsv(file);
    } catch (error) {
      console.error(error);
      return {
        message: 'CSV内容の確認に失敗しました',
        errors: ['CSVを読み取れませんでした。ファイル形式を確認してください。'],
        rows: [],
      };
    }

    try {
      const csvHeaders = (result.meta.fields ?? []).map(header => normalizeCsvHeader(String(header ?? '')));
      const expectedHeaders = getEmployeeCsvHeaders(inputFormat);
      const hasAllHeaders = expectedHeaders.every(header => csvHeaders.includes(header));

      if (!hasAllHeaders) {
        return {
          message: 'CSVの列がひな形と一致していません',
          errors: [`読み取った列：${csvHeaders.join('、')}`],
          rows: [],
        };
      }

      const parseErrorMap = this.createParseErrorMap(result.errors);

      const rowInfos = result.data.map((row, index) => ({
        row,
        rowNumber: index + 2,
      }));
      const inputStartIndex = rowInfos.findIndex(rowInfo => this.isInputStartRowSafely(rowInfo.row, inputFormat));
      const importRowInfos = (inputStartIndex >= 0 ? rowInfos.slice(inputStartIndex + 1) : rowInfos)
        .filter(rowInfo => Object.values(rowInfo.row).some(value => String(value ?? '').trim()));

      if (!importRowInfos.length) {
        return {
          message: 'CSVに取り込み対象のデータがありません',
          errors: [],
          rows: [],
        };
      }

      await this.employeeService.getAllEmployees();
      const employeeNameMap = this.employeeService.allEmployeeNameMap();
      const csvEmployeeIds = new Set<string>();
      const previewRows: CsvMonthlySalaryPreviewRow[] = [];

      for (const { row, rowNumber } of importRowInfos) {
        const rowErrors: string[] = [...(parseErrorMap.get(rowNumber) ?? [])];
        let payroll: Partial<Payroll> | null = null;

        try {
          if (Object.values(row).some(value => /[^\x00-\x7F]/.test(String(value ?? '')))) {
            rowErrors.push(`${rowNumber}行目：半角で入力してください`);
          }
          // CSVの1行をPayroll登録用の形に変換する。
          // ここで作るpayrollには会社IDも入れる。社員IDとpayrollIdは登録時にPayrollService側で付与される。
          payroll = this.toPayrollFromCsvRow(row, rowNumber, rowErrors, inputFormat, payrollId);

          const employeeId = this.getCsvValueSafely(row, 'employeeId', inputFormat);
          const isEmployeeIdValid = !employeeId || /^[a-zA-Z0-9]+$/.test(employeeId);

          if (employeeId && !isEmployeeIdValid) {
            rowErrors.push(`${rowNumber}行目：社員IDは半角英数字で入力してください`);
          }

          if (employeeId && csvEmployeeIds.has(employeeId)) {
            rowErrors.push(`${rowNumber}行目：社員ID ${employeeId} がCSV内で重複しています`);
          }

          if (employeeId) {
            csvEmployeeIds.add(employeeId);
          }

          if (employeeId && isEmployeeIdValid && !employeeNameMap[employeeId]) {
            rowErrors.push(`${rowNumber}行目：社員ID ${employeeId} は登録済みの社員と一致していません`);
          }

          if (employeeId && isEmployeeIdValid) {
            const employee = this.employeeService.allEmployees().find(item => item.employeeId === employeeId);
            if (employee && this.employeeService.isRetired(employee)) {
              rowErrors.push(`${rowNumber}行目：社員ID ${employeeId} は退社済みのため、給与入力の対象外です`);
            }
          }

          if (employeeId && isEmployeeIdValid && payroll) {
            const existingPayroll = await this.payrollService.getPayroll(employeeId, payroll);
            if (existingPayroll) {
              rowErrors.push(`${rowNumber}行目：社員ID ${employeeId} の同じ対象月の給与・勤務実績は既に登録済みです`);
            }
          }
        } catch (error) {
          console.error(error);
          rowErrors.push(`${rowNumber}行目：CSVデータの確認中にエラーが発生しました`);
        }

        try {
          previewRows.push(this.createPreviewRow(row, rowNumber, payroll, rowErrors, inputFormat, payrollId));
        } catch (error) {
          console.error(error);
          previewRows.push(this.createFallbackPreviewRow(
            row,
            rowNumber,
            [...rowErrors, `${rowNumber}行目：CSVデータの表示中にエラーが発生しました`],
            inputFormat,
          ));
        }
      }

      const errorCount = previewRows.filter(row => row.errors.length > 0).length;
      return {
        message: `CSV確認完了：登録可能 ${previewRows.length - errorCount} 件、エラー ${errorCount} 件`,
        errors: previewRows.flatMap(row => row.errors),
        rows: previewRows,
      };
    } catch (error) {
      console.error(error);
      return this.createPreviewFallbackResult(result, inputFormat);
    }
  }

  async registerPreviewRows(rows: CsvMonthlySalaryPreviewRow[]): Promise<CsvMonthlySalaryImportResult> {
    // プレビュー画面で選択されていて、エラーがない行だけを登録対象にする。
    const selectedRows = rows.filter(row => row.selected && row.canRegister && row.payroll);
    if (!selectedRows.length) {
      return {
        message: '登録対象の行を選択してください',
        errors: [],
      };
    }

    let successCount = 0;
    const errors: string[] = [];

    for (const row of selectedRows) {
      try {
        // row.payrollはプレビュー作成時点でCSVの値・companyId・payrollIdを入れた登録用データ。
        // employeeIdはPayrollService.registerPayroll側で付与される。
        const result = await this.payrollService.registerPayroll(row.employeeId, row.payroll!);
        if (result) {
          successCount++;
        } else {
          errors.push(`${row.rowNumber}行目：社員ID ${row.employeeId} の登録に失敗しました`);
        }
      } catch (error) {
        console.error(error);
        errors.push(`${row.rowNumber}行目：社員ID ${row.employeeId} の登録中にエラーが発生しました`);
      }
    }

    if (errors.length) {
      return {
        message: `CSV取り込み完了：成功 ${successCount} 件、失敗 ${errors.length} 件`,
        errors,
      };
    }

    return {
      message: `CSV取り込みが完了しました：${successCount} 件`,
      errors: [],
    };
  }

  private parseCsv(file: File): Promise<Papa.ParseResult<Record<string, string>>> {
    return new Promise((resolve, reject) => {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: result => resolve(result),
        error: error => reject(error),
      });
    });
  }

  private createPreviewFallbackResult(
    result: Papa.ParseResult<Record<string, string>>,
    inputFormat: SalaryInputFormat,
  ): CsvMonthlySalaryPreviewResult {
    const rows = result.data
      .map((row, index) => ({ row, rowNumber: index + 2 }))
      .filter(rowInfo => Object.values(rowInfo.row).some(value => String(value ?? '').trim()))
      .map(({ row, rowNumber }) =>
        this.createFallbackPreviewRow(
          row,
          rowNumber,
          [`${rowNumber}行目：CSVデータの確認中にエラーが発生しました`],
          inputFormat,
        )
      );

    return {
      message: `CSV確認完了：登録可能 0 件、エラー ${rows.length} 件`,
      errors: rows.flatMap(row => row.errors),
      rows,
    };
  }

  private createParseErrorMap(errors: Papa.ParseError[]): Map<number, string[]> {
    const errorMap = new Map<number, string[]>();
    const parseErrors = errors.filter(error => error.code !== 'TooFewFields' && error.row !== undefined);

    for (const error of parseErrors) {
      const rowNumber = error.row! + 2;
      const rowErrors = errorMap.get(rowNumber) ?? [];
      rowErrors.push(`${rowNumber}行目：${error.message}`);
      errorMap.set(rowNumber, rowErrors);
    }

    return errorMap;
  }

  private createPreviewRow(
    row: Record<string, string>,
    rowNumber: number,
    payroll: Partial<Payroll> | null,
    errors: string[],
    inputFormat: SalaryInputFormat,
    payrollId: string,
  ): CsvMonthlySalaryPreviewRow {
    const defaults = this.getDefaultPeriodDates(payrollId);

    // 画面表示用の1行を作る。payrollがnullなら登録不可の行として表示される。
    return {
      rowNumber,
      selected: errors.length === 0,
      canRegister: errors.length === 0,
      errors,
      payroll: payroll ?? undefined,
      employeeId: this.getCsvValueSafely(row, 'employeeId', inputFormat),
      actualWorkingDays: payroll?.actualWorkingDays,
      actualWorkingHours: payroll?.actualWorkingHours,
      paymentDate: this.getCsvValueSafely(row, 'paymentDate', inputFormat) || defaults.paymentDateText,
      targetPeriodStart: this.getCsvValueSafely(row, 'targetPeriodStart', inputFormat) || defaults.targetPeriodStartText,
      targetPeriodEnd: this.getCsvValueSafely(row, 'targetPeriodEnd', inputFormat) || defaults.targetPeriodEndText,
      fixedSalary: payroll?.fixedSalary,
      actualPaymentAmount: payroll?.actualPaymentAmount,
    };
  }

  private createFallbackPreviewRow(
    row: Record<string, string>,
    rowNumber: number,
    errors: string[],
    inputFormat: SalaryInputFormat,
  ): CsvMonthlySalaryPreviewRow {
    return {
      rowNumber,
      selected: false,
      canRegister: false,
      errors,
      employeeId: this.getCsvValueSafely(row, 'employeeId', inputFormat),
      paymentDate: this.getCsvValueSafely(row, 'paymentDate', inputFormat),
      targetPeriodStart: this.getCsvValueSafely(row, 'targetPeriodStart', inputFormat),
      targetPeriodEnd: this.getCsvValueSafely(row, 'targetPeriodEnd', inputFormat),
    };
  }

  private getCsvValueSafely(
    row: Record<string, string>,
    key: Parameters<typeof getEmployeeCsvValue>[1],
    inputFormat: SalaryInputFormat,
  ): string {
    try {
      return getEmployeeCsvValue(row, key, inputFormat);
    } catch (error) {
      console.error(error);
      return '';
    }
  }

  private isInputStartRowSafely(row: Record<string, string>, inputFormat: SalaryInputFormat): boolean {
    try {
      return isEmployeeCsvInputStartRow(row, inputFormat);
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  private toPayrollFromCsvRow(
    row: Record<string, string>,
    rowNumber: number,
    errors: string[],
    inputFormat: SalaryInputFormat,
    payrollId: string,
  ): Partial<Payroll> | null {
    // CSV文字列をFirestoreに保存しやすい型へ変換する。
    // 日付はTimestamp、数値はnumberへ変換し、登録に必要な値が足りなければerrorsへ理由を追加する。
    const companyId = this.companyId;
    const employeeId = this.getCsvValueSafely(row, 'employeeId', inputFormat);
    const actualWorkingDaysText = this.getCsvValueSafely(row, 'actualWorkingDays', inputFormat);
    const actualWorkingHoursText = this.getCsvValueSafely(row, 'actualWorkingHours', inputFormat);
    const defaults = this.getDefaultPeriodDates(payrollId);
    const paymentDateText = this.getCsvValueSafely(row, 'paymentDate', inputFormat) || defaults.paymentDateText;
    const targetPeriodStartText = this.getCsvValueSafely(row, 'targetPeriodStart', inputFormat) || defaults.targetPeriodStartText;
    const targetPeriodEndText = this.getCsvValueSafely(row, 'targetPeriodEnd', inputFormat) || defaults.targetPeriodEndText;
    const actualWorkingDays = this.toNumber(actualWorkingDaysText);
    const actualWorkingHours = this.toNumber(actualWorkingHoursText);
    const paymentDate = this.toTimestamp(paymentDateText);
    const targetPeriodStart = this.toTimestamp(targetPeriodStartText);
    const targetPeriodEnd = this.toTimestamp(targetPeriodEndText);
    const missingFields: string[] = [];

    if (!companyId) {
      errors.push(`${rowNumber}行目：会社IDが取得できません`);
      return null;
    }

    if (!employeeId) missingFields.push('社員ID');
    if (!actualWorkingDaysText) missingFields.push('勤務日数');
    if (!actualWorkingHoursText) missingFields.push('勤務時間');

    if (missingFields.length) {
      errors.push(`${rowNumber}行目：${missingFields.join('、')}が未入力です`);
      return null;
    }

    if (actualWorkingDays === null || actualWorkingHours === null) {
      errors.push(`${rowNumber}行目：勤務日数または勤務時間は数値で入力してください`);
      return null;
    }

    if (actualWorkingDays < 0 || actualWorkingHours < 0) {
      errors.push(`${rowNumber}行目：勤務日数または勤務時間にマイナスの値は入力できません`);
      return null;
    }

    if (actualWorkingHours > 0 && actualWorkingDays === 0) {
      errors.push(`${rowNumber}行目：勤務時間がある場合、勤務日数は1日以上で入力してください`);
      return null;
    }

    if (actualWorkingDays > 0 && actualWorkingHours === 0) {
      errors.push(`${rowNumber}行目：勤務日数がある場合、勤務時間は1時間以上で入力してください`);
      return null;
    }

    if (!paymentDate || !targetPeriodStart || !targetPeriodEnd) {
      errors.push(`${rowNumber}行目：支給日または対象期間の日付形式が正しくありません`);
      return null;
    }

    if (!this.isTargetPeriodStartInPayrollMonth(targetPeriodStart.toDate(), payrollId)) {
      errors.push(`${rowNumber}行目：対象期間開始日は作業月と同じ月で入力してください`);
      return null;
    }

    const salary = this.getSalaryAmounts(row, rowNumber, errors, inputFormat);
    if (!salary) return null;

    if (actualWorkingDays > 0 && salary.actualPaymentAmount === 0) {
      errors.push(`${rowNumber}行目：勤務実績がある場合、総支給額は1円以上で入力してください`);
      return null;
    }

    if (salary.actualPaymentAmount < salary.fixedSalary) {
      errors.push(`${rowNumber}行目：総支給額は固定給以上で入力してください`);
      return null;
    }

    // companyIdとpayrollIdはcollectionGroup検索で絞り込むため、payrollドキュメントにも保存する。
    // employeeIdはPayrollService.registerPayrollで付与する。
    return {
      payrollId,
      companyId,
      type: '毎月',
      actualWorkingDays,
      actualWorkingHours: Math.round(actualWorkingHours * 12 / 52),
      paymentDate,
      targetPeriod: [targetPeriodStart, targetPeriodEnd],
      fixedSalary: salary.fixedSalary,
      actualPaymentAmount: salary.actualPaymentAmount,
    };
  }

  private getSalaryAmounts(
    row: Record<string, string>,
    rowNumber: number,
    errors: string[],
    inputFormat: SalaryInputFormat,
  ): { fixedSalary: number; actualPaymentAmount: number } | null {
    if (inputFormat === 1) {
      const basicSalaryText = this.getCsvValueSafely(row, 'basicSalary', inputFormat);
      const fixedAllowanceText = this.getCsvValueSafely(row, 'fixedAllowance', inputFormat);
      const transportAllowanceText = this.getCsvValueSafely(row, 'transportAllowance', inputFormat);
      const variableAllowanceText = this.getCsvValueSafely(row, 'variableAllowance', inputFormat);
      const basicSalary = this.toNumber(basicSalaryText);
      const fixedAllowance = this.toNumber(fixedAllowanceText) ?? 0;
      const transportAllowance = this.toNumber(transportAllowanceText) ?? 0;
      const variableAllowance = this.toNumber(variableAllowanceText) ?? 0;

      if (!basicSalaryText) {
        errors.push(`${rowNumber}行目：基本給が未入力です`);
        return null;
      }

      if (basicSalary === null || (fixedAllowanceText && this.toNumber(fixedAllowanceText) === null) || (transportAllowanceText && this.toNumber(transportAllowanceText) === null) || (variableAllowanceText && this.toNumber(variableAllowanceText) === null)) {
        errors.push(`${rowNumber}行目：給与内訳は数値で入力してください`);
        return null;
      }

      if (basicSalary < 0 || fixedAllowance < 0 || transportAllowance < 0 || variableAllowance < 0) {
        errors.push(`${rowNumber}行目：給与内訳にマイナスの値は入力できません`);
        return null;
      }

      const fixedSalary = basicSalary + fixedAllowance + transportAllowance;
      return {
        fixedSalary,
        actualPaymentAmount: fixedSalary + variableAllowance,
      };
    }

    const fixedSalaryText = this.getCsvValueSafely(row, 'fixedSalary', inputFormat);
    const actualPaymentAmountText = this.getCsvValueSafely(row, 'actualPaymentAmount', inputFormat);
    const fixedSalary = this.toNumber(fixedSalaryText);
    const actualPaymentAmount = this.toNumber(actualPaymentAmountText);

    if (!fixedSalaryText || !actualPaymentAmountText) {
      errors.push(`${rowNumber}行目：固定給または総支給額が未入力です`);
      return null;
    }

    if (fixedSalary === null || actualPaymentAmount === null) {
      errors.push(`${rowNumber}行目：固定給または総支給額は数値で入力してください`);
      return null;
    }

    if (fixedSalary < 0 || actualPaymentAmount < 0) {
      errors.push(`${rowNumber}行目：固定給または総支給額にマイナスの値は入力できません`);
      return null;
    }

    return { fixedSalary, actualPaymentAmount };
  }

  private getDefaultPeriodDates(payrollId: string) {
    // 会社設定から支給日と対象期間の初期値を作る。
    // CSVに日付が入っていない場合、この値をプレビューと登録データに使う。
    const settings = this.companyService.company()?.settings;
    const [yearText, monthText] = payrollId.split('-');
    const workingYear = Number(yearText);
    const targetPeriodMonthNumber = Number(monthText);
    const paymentMonth = settings?.paymentMonth ?? '翌月';
    const paymentMonthNumber = paymentMonth === '当月' ? targetPeriodMonthNumber : targetPeriodMonthNumber + 1;
    const paymentDate = settings?.paymentDate ?? 25;
    const targetPeriod = settings?.targetPeriod ?? [1, 31];

    return {
      paymentDateText: this.payrollService.toDateInputValue(workingYear, paymentMonthNumber, paymentDate),
      targetPeriodStartText: this.payrollService.toDateInputValue(workingYear, targetPeriodMonthNumber, targetPeriod[0]),
      targetPeriodEndText: this.payrollService.toDateInputValue(
        workingYear,
        targetPeriod[1] < targetPeriod[0] ? targetPeriodMonthNumber + 1 : targetPeriodMonthNumber,
        targetPeriod[1],
      ),
    };
  }

  private isTargetPeriodStartInPayrollMonth(targetPeriodStart: Date, payrollId: string): boolean {
    const [yearText, monthText] = payrollId.split('-');
    const workingYear = Number(yearText);
    const targetPeriodMonth = Number(monthText);

    return targetPeriodStart.getFullYear() === workingYear
      && targetPeriodStart.getMonth() + 1 === targetPeriodMonth;
  }

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

  private toNumber(value: string): number | null {
    if (!value) return null;

    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

}
