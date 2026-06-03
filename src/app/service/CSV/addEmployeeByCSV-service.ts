import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import Papa from 'papaparse';
import { EMPLOYMENT_CATEGORIES, EmploymentCategory, LEAVE_TYPES, LeaveType, WORK_STATUSES, WORK_STYLES, WorkStatus, WorkStyle } from '../../constants/model-constants';
import { createEmployeeCsvTemplateCsv, EMPLOYEE_CSV_HEADERS, getEmployeeCsvValue, normalizeCsvHeader } from '../../CSVtemplate/employeeData-import';
import { Employee } from '../../model/employee';
import { EmployeeService } from '../Firestore/employee-service';
import { OfficeService } from '../Firestore/office-service';

export type CsvImportResult = {
  message: string;
  errors: string[];
};

export type CsvEmployeePreviewRow = {
  rowNumber: number;
  selected: boolean;
  canRegister: boolean;
  errors: string[];
  employee?: Partial<Employee>;
  employeeId: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  hireDate: string;
  workStatus: string;
  leaveTypes: string;
  employmentCategory: string;
  workStyle: string;
  officeName: string;
  contractedWorkingHoursPerWeek?: number;
  contractedWorkingDaysPerMonth?: number;
  fixedSalary?: number;
  transportationExpenses?: number;
};

export type CsvPreviewResult = {
  message: string;
  errors: string[];
  rows: CsvEmployeePreviewRow[];
};

@Injectable({
  providedIn: 'root',
})
export class AddEmployeeByCSVService {

  private employeeService = inject(EmployeeService);
  private officeService = inject(OfficeService);
  private csvDataRowNumberOffset = 2;

  /** CSVひな形ダウンロード */
  downloadCsvTemplate() {
    // ひな形として出力する案内行・入力例・入力開始行をCSV文字列として作成する
    // 案内行は1列だけにして、テキストで見たときに不要な「,,,,」が出ないようにする
    const csv = createEmployeeCsvTemplateCsv();
    // Excelで開いたときの文字化けを防ぐため、先頭にBOM(\uFEFF)を付けてCSVファイル化する
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    // ブラウザ上でダウンロードできるように、一時的なURLを作成する
    const url = URL.createObjectURL(blob);
    // aタグをメモリ上で作り、hrefにCSVのURL、downloadに保存時のファイル名を設定する
    const link = document.createElement('a');
    link.href = url;
    link.download = 'employee-template.csv';
    // 作成したaタグをクリックしたことにして、ユーザーにCSVをダウンロードさせる
    link.click();
    // 一時URLは使い終わったら解放して、ブラウザのメモリに残らないようにする
    URL.revokeObjectURL(url);
  }

  /** 新規従業員登録（一括CSV取り込み） */
  async previewCsv(file: File): Promise<CsvPreviewResult> {
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
      const csvHeaders = (result.meta.fields ?? []).map(header => normalizeCsvHeader(header));
      const hasAllHeaders = EMPLOYEE_CSV_HEADERS.every(header => csvHeaders.includes(header));
      if (!hasAllHeaders) {
        return this.createCsvPreviewErrorRows(result, 'CSVの列がひな形と一致していません');
      }

      const rowInfos = result.data.map((row, index) => ({
        row: this.normalizeCsvRow(row),
        rowNumber: index + this.csvDataRowNumberOffset,
      }));
      const inputStartIndex = rowInfos.findIndex(rowInfo => this.isInputStartRow(rowInfo.row));
      const parseErrorMap = this.createParseErrorMap(result.errors, inputStartIndex);
      const importRowInfos = (inputStartIndex >= 0 ? rowInfos.slice(inputStartIndex + 1) : rowInfos)
        .filter(rowInfo => !this.isGuideRow(rowInfo.row))
        .filter(rowInfo => Object.values(rowInfo.row).some(value => String(value ?? '').trim()));
      if (!importRowInfos.length) {
        return {
          message: 'CSVに取り込み対象のデータがありません',
          errors: [],
          rows: [],
        };
      }

      const csvEmployeeIds = new Set<string>();
      const previewRows: CsvEmployeePreviewRow[] = [];

      let employeeNameMap: Record<string, string> = {};
      try {
        await this.employeeService.getAllEmployees();
        employeeNameMap = this.employeeService.allEmployeeNameMap();
      } catch (error) {
        console.error(error);
      }
      
      let officeIdByNameMap: Record<string, string> = {};
      try {
        await this.officeService.getAllOffice();
        officeIdByNameMap = this.createOfficeIdByNameMap();
      } catch (error) {
        console.error(error);
      }

      for (const { row, rowNumber } of importRowInfos) {
        const rowErrors: string[] = [...(parseErrorMap.get(rowNumber) ?? [])];
        let employee: Partial<Employee> | null = null;
        const employeeId = this.getEmployeeCsvValueSafely(row, 'employeeId');

        try {
          employee = this.toEmployeeFromCsvRow(row, rowNumber, rowErrors, officeIdByNameMap);
        } catch (error) {
          console.error(error);
          rowErrors.push(`${rowNumber}行目：CSVデータの確認中にエラーが発生しました`);
        }

        if (employeeId && csvEmployeeIds.has(employeeId)) {
          rowErrors.push(`${rowNumber}行目：社員ID ${employeeId} がCSV内で重複しています`);
        }

        if (employeeId) {
          csvEmployeeIds.add(employeeId);
        }

        if (employeeId && employeeNameMap[employeeId]) {
          rowErrors.push(`${rowNumber}行目：社員ID ${employeeId} は既に登録済みです`);
        }

        previewRows.push(this.createPreviewRow(row, rowNumber, employee, rowErrors));
      }

      const errorCount = previewRows.filter(row => row.errors.length > 0).length;
      return {
        message: `CSV確認完了：登録可能 ${previewRows.length - errorCount} 件、エラー ${errorCount} 件`,
        errors: previewRows.flatMap(row => row.errors),
        rows: previewRows,
      };
    } catch (error) {
      console.error(error);
      return this.createCsvPreviewErrorRows(result, 'CSVデータの確認中にエラーが発生しました');
    }
  }

  /** チェックされたCSVプレビュー行を登録 */
  async registerPreviewRows(rows: CsvEmployeePreviewRow[]): Promise<CsvImportResult> {
    const selectedRows = rows.filter(row => row.selected && row.canRegister && row.employee);
    if (!selectedRows.length) {
      return {
        message: '登録対象の行を選択してください',
        errors: [],
      };
    }

    let successCount = 0;
    const errors: string[] = [];

    await this.employeeService.getAllEmployees(true);
    const employeeNameMap = this.employeeService.allEmployeeNameMap();

    for (const row of selectedRows) {
      const employee = row.employee!;
      if (employeeNameMap[employee.employeeId!]) {
        errors.push(`${row.rowNumber}行目：社員ID ${employee.employeeId} は既に登録済みです`);
        continue;
      }

      try {
        const result = await this.employeeService.registerEmployee(employee);
        if (result) {
          successCount++;
        } else {
          errors.push(`${row.rowNumber}行目：社員ID ${employee.employeeId} の登録に失敗しました`);
        }
      } catch (error) {
        console.error(error);
        errors.push(`${row.rowNumber}行目：社員ID ${employee.employeeId} の登録中にエラーが発生しました`);
      }
    }

    if (successCount > 0) {
      await this.employeeService.getAllEmployees(true);
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

  private createImportCsvText(text: string): string {
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

  private createParseErrorMap(errors: Papa.ParseError[], inputStartIndex: number): Map<number, string[]> {
    const errorMap = new Map<number, string[]>();
    const parseErrors = errors.filter(error => error.row !== undefined);

    for (const error of parseErrors) {
      if (inputStartIndex >= 0 && error.row! <= inputStartIndex) continue;

      const rowNumber = error.row! + this.csvDataRowNumberOffset;
      const rowErrors = errorMap.get(rowNumber) ?? [];
      rowErrors.push(`${rowNumber}行目：${this.toJapaneseParseErrorMessage(error)}`);
      errorMap.set(rowNumber, rowErrors);
    }

    return errorMap;
  }

  private createCsvPreviewErrorRows(
    result: Papa.ParseResult<Record<string, string>>,
    message: string,
  ): CsvPreviewResult {
    const allRowInfos = result.data.map((row, index) => ({
      row: this.normalizeCsvRow(row),
      rowNumber: index + this.csvDataRowNumberOffset,
    }));
    const inputStartIndex = allRowInfos.findIndex(rowInfo => this.isInputStartRow(rowInfo.row));
    const rowInfos = (inputStartIndex >= 0 ? allRowInfos.slice(inputStartIndex + 1) : allRowInfos)
      .filter(rowInfo => !this.isGuideRow(rowInfo.row))
      .filter(rowInfo => Object.values(rowInfo.row).some(value => String(value ?? '').trim()));
    const rows = rowInfos.map(rowInfo =>
      this.createPreviewRow(rowInfo.row, rowInfo.rowNumber, null, [`${rowInfo.rowNumber}行目：${message}`])
    );

    return {
      message: `CSV確認完了：登録可能 0 件、エラー ${rows.length} 件`,
      errors: rows.flatMap(row => row.errors),
      rows,
    };
  }

  private isGuideRow(row: Record<string, string>) {
    const employeeId = this.getEmployeeCsvValueSafely(row, 'employeeId');
    return employeeId === '例）' || employeeId === '入力内容）';
  }

  private isInputStartRow(row: Record<string, string>) {
    return this.getEmployeeCsvValueSafely(row, 'employeeId') === '入力内容）';
  }

  private toJapaneseParseErrorMessage(error: Papa.ParseError) {
    if (error.code === 'TooManyFields') {
      return '列数がひな形より多いです。余分なカンマが入っていないか確認してください';
    }

    if (error.code === 'TooFewFields') {
      return '未入力の項目があります';
    }

    return 'CSVの形式が正しくありません';
  }

  private normalizeCsvRow(row: Record<string, string> | null | undefined): Record<string, string> {
    return row && typeof row === 'object' ? row : {};
  }

  private createPreviewRow(
    row: Record<string, string>,
    rowNumber: number,
    employee: Partial<Employee> | null,
    errors: string[],
  ): CsvEmployeePreviewRow {
    return {
      rowNumber,
      selected: errors.length === 0,
      canRegister: errors.length === 0,
      errors,
      employee: employee ?? undefined,
      employeeId: employee?.employeeId ?? this.getEmployeeCsvValueSafely(row, 'employeeId'),
      firstName: employee?.firstName ?? this.getEmployeeCsvValueSafely(row, 'firstName'),
      lastName: employee?.lastName ?? this.getEmployeeCsvValueSafely(row, 'lastName'),
      birthDate: this.getEmployeeCsvValueSafely(row, 'birthDate'),
      hireDate: this.getEmployeeCsvValueSafely(row, 'hireDate'),
      workStatus: employee?.workStatus ?? this.getEmployeeCsvValueSafely(row, 'workStatus'),
      leaveTypes: employee?.leaveTypes ?? this.getEmployeeCsvValueSafely(row, 'leaveTypes'),
      employmentCategory: employee?.employmentContract?.employmentCategory ?? this.getEmployeeCsvValueSafely(row, 'employmentCategory'),
      workStyle: employee?.employmentContract?.workStyle ?? this.getEmployeeCsvValueSafely(row, 'workStyle'),
      officeName: this.getEmployeeCsvValueSafely(row, 'officeId'),
      contractedWorkingHoursPerWeek: employee?.employmentContract?.contractedWorkingHoursPerWeek,
      contractedWorkingDaysPerMonth: employee?.employmentContract?.contractedWorkingDaysPerMonth,
      fixedSalary: employee?.employmentContract?.fixedSalary,
      transportationExpenses: employee?.employmentContract?.transportationExpenses,
    };
  }

  private getEmployeeCsvValueSafely(row: Record<string, string>, key: Parameters<typeof getEmployeeCsvValue>[1]) {
    try {
      return getEmployeeCsvValue(row, key);
    } catch (error) {
      console.error(error);
      return '';
    }
  }

  private toEmployeeFromCsvRow(
    row: Record<string, string>,
    rowNumber: number,
    errors: string[],
    officeIdByNameMap: Record<string, string>,
  ): Partial<Employee> | null {
    const employeeId = this.getEmployeeCsvValueSafely(row, 'employeeId');
    const firstName = this.getEmployeeCsvValueSafely(row, 'firstName');
    const lastName = this.getEmployeeCsvValueSafely(row, 'lastName');
    const birthDateText = this.getEmployeeCsvValueSafely(row, 'birthDate');
    const hireDateText = this.getEmployeeCsvValueSafely(row, 'hireDate');
    const birthDate = this.toTimestamp(birthDateText);
    const hireDate = this.toTimestamp(hireDateText);
    const workStatus = this.getEmployeeCsvValueSafely(row, 'workStatus');
    const leaveTypes = this.getEmployeeCsvValueSafely(row, 'leaveTypes');
    const employmentCategory = this.getEmployeeCsvValueSafely(row, 'employmentCategory');
    const workStyle = this.getEmployeeCsvValueSafely(row, 'workStyle');
    const officeName = this.getEmployeeCsvValueSafely(row, 'officeId');
    const officeId = officeIdByNameMap[officeName];
    const contractedWorkingHoursPerWeekText = this.getEmployeeCsvValueSafely(row, 'contractedWorkingHoursPerWeek');
    const contractedWorkingDaysPerMonthText = this.getEmployeeCsvValueSafely(row, 'contractedWorkingDaysPerMonth');
    const fixedSalaryText = this.getEmployeeCsvValueSafely(row, 'fixedSalary');
    const transportationExpensesText = this.getEmployeeCsvValueSafely(row, 'transportationExpenses');
    const contractedWorkingHoursPerWeek = this.toNumber(contractedWorkingHoursPerWeekText);
    const contractedWorkingDaysPerMonth = this.toNumber(contractedWorkingDaysPerMonthText);
    const fixedSalary = this.toNumber(fixedSalaryText);
    const transportationExpenses = this.toNumber(transportationExpensesText);
    const missingFields: string[] = [];
    const errorCountBeforeValidation = errors.length;

    if (!employeeId) {
      missingFields.push('社員ID');
    }

    if (!firstName) {
      missingFields.push('姓');
    }

    if (!lastName) {
      missingFields.push('名');
    }

    if (!birthDateText) {
      missingFields.push('生年月日');
    }

    if (!hireDateText) {
      missingFields.push('入社日');
    }

    if (!workStatus) {
      missingFields.push('勤務状況');
    }

    if (!employmentCategory) {
      missingFields.push('雇用区分');
    }

    if (!workStyle) {
      missingFields.push('勤務形態');
    }

    if (!officeName) {
      missingFields.push('事業所名');
    }

    if (!fixedSalaryText) {
      missingFields.push('現在の固定給');
    }

    if (missingFields.length) {
      errors.push(`${rowNumber}行目：${missingFields.join('、')}が未入力です`);
    }

    const halfWidthErrors = this.validateHalfWidthFields(rowNumber, {
      employeeId,
      birthDateText,
      hireDateText,
      contractedWorkingHoursPerWeekText,
      contractedWorkingDaysPerMonthText,
      fixedSalaryText,
      transportationExpensesText,
    });
    if (halfWidthErrors.length) {
      errors.push(...halfWidthErrors);
    }

    if (!birthDate || !hireDate) {
      errors.push(`${rowNumber}行目：生年月日または入社日の形式が正しくありません`);
    }

    if (workStatus) {
      this.validateCsvChoice(rowNumber, '勤務状況', workStatus, WORK_STATUSES, errors);
    }
    if (leaveTypes) {
      this.validateCsvChoice(rowNumber, '休職種別', leaveTypes, LEAVE_TYPES, errors);
    }
    const isEmploymentCategoryValid = employmentCategory
      ? this.validateCsvChoice(rowNumber, '雇用区分', employmentCategory, EMPLOYMENT_CATEGORIES, errors)
      : false;
    const isWorkStyleValid = workStyle
      ? this.validateCsvChoice(rowNumber, '勤務形態', workStyle, WORK_STYLES, errors)
      : false;

    if (workStatus === '休職中' && !leaveTypes) {
      errors.push(`${rowNumber}行目：休職種別が未入力です`);
    }

    if (isEmploymentCategoryValid && isWorkStyleValid && this.isTransportationExpensesRequired(employmentCategory as EmploymentCategory, workStyle as WorkStyle) && !transportationExpensesText) {
      errors.push(`${rowNumber}行目：通勤手当が未入力です`);
    }

    if (officeName && !officeId) {
      errors.push(`${rowNumber}行目：事業所名「${officeName}」が登録済みの事業所と一致していません`);
    }

    if (contractedWorkingHoursPerWeekText && contractedWorkingHoursPerWeek === null) {
      errors.push(`${rowNumber}行目：契約労働時間は数値で入力してください`);
    }

    if (contractedWorkingDaysPerMonthText && contractedWorkingDaysPerMonth === null) {
      errors.push(`${rowNumber}行目：契約労働日数は数値で入力してください`);
    }

    if (fixedSalaryText && fixedSalary === null) {
      errors.push(`${rowNumber}行目：現在の固定給は数値で入力してください`);
    }

    if (transportationExpensesText && transportationExpenses === null) {
      errors.push(`${rowNumber}行目：通勤手当は数値で入力してください`);
    }

    if (contractedWorkingHoursPerWeek !== null && contractedWorkingHoursPerWeek < 0) {
      errors.push(`${rowNumber}行目：契約労働時間にマイナスの値は入力できません`);
    }

    if (contractedWorkingDaysPerMonth !== null && contractedWorkingDaysPerMonth < 0) {
      errors.push(`${rowNumber}行目：契約労働日数にマイナスの値は入力できません`);
    }

    if (fixedSalary !== null && fixedSalary < 0) {
      errors.push(`${rowNumber}行目：現在の固定給にマイナスの値は入力できません`);
    }

    if (transportationExpenses !== null && transportationExpenses < 0) {
      errors.push(`${rowNumber}行目：通勤手当にマイナスの値は入力できません`);
    }

    if (errors.length > errorCountBeforeValidation) {
      return null;
    }

    return {
      employeeId,
      firstName,
      lastName,
      birthDate: birthDate!,
      hireDate: hireDate!,
      workStatus: workStatus as WorkStatus,
      ...(workStatus === '休職中' ? { leaveTypes: leaveTypes as LeaveType } : {}),
      employmentContract: {
        employmentCategory: employmentCategory as EmploymentCategory,
        workStyle: workStyle as WorkStyle,
        officeId,
        contractedWorkingHoursPerWeek: contractedWorkingHoursPerWeek ?? 40,
        contractedWorkingDaysPerMonth: contractedWorkingDaysPerMonth ?? 20,
        fixedSalary: fixedSalary!,
        ...(transportationExpensesText ? { transportationExpenses: transportationExpenses! } : {}),
      },
    };
  }

  private isTransportationExpensesRequired(employmentCategory: EmploymentCategory, workStyle: WorkStyle) {
    return (employmentCategory === '契約社員' && workStyle === '時短') || employmentCategory === 'パート';
  }

  private validateCsvChoice(
    rowNumber: number,
    fieldName: string,
    value: string,
    options: readonly string[],
    errors: string[],
  ) {
    if (options.includes(value)) {
      return true;
    }

    errors.push(`${rowNumber}行目：${fieldName}が選択肢と一致していません`);
    return false;
  }

  private validateHalfWidthFields(
    rowNumber: number,
    values: {
      employeeId: string;
      birthDateText: string;
      hireDateText: string;
      contractedWorkingHoursPerWeekText: string;
      contractedWorkingDaysPerMonthText: string;
      fixedSalaryText: string;
      transportationExpensesText: string;
    }
  ) {
    const errors: string[] = [];
    const halfWidthAlphaNumeric = /^[a-zA-Z0-9]+$/;
    const halfWidthDate = /^\d{4}-\d{2}-\d{2}$/;
    const halfWidthNumber = /^\d+$/;

    if (values.employeeId && !halfWidthAlphaNumeric.test(values.employeeId)) {
      errors.push(`${rowNumber}行目：社員IDは半角英数字で入力してください`);
    }

    if (values.birthDateText && !halfWidthDate.test(values.birthDateText)) {
      errors.push(`${rowNumber}行目：生年月日は半角のyyyy-mm-dd形式で入力してください`);
    }

    if (values.hireDateText && !halfWidthDate.test(values.hireDateText)) {
      errors.push(`${rowNumber}行目：入社日は半角のyyyy-mm-dd形式で入力してください`);
    }

    if (values.contractedWorkingHoursPerWeekText && !halfWidthNumber.test(values.contractedWorkingHoursPerWeekText)) {
      errors.push(`${rowNumber}行目：契約労働時間は半角数字で入力してください`);
    }

    if (values.contractedWorkingDaysPerMonthText && !halfWidthNumber.test(values.contractedWorkingDaysPerMonthText)) {
      errors.push(`${rowNumber}行目：契約労働日数は半角数字で入力してください`);
    }

    if (values.fixedSalaryText && !halfWidthNumber.test(values.fixedSalaryText)) {
      errors.push(`${rowNumber}行目：現在の固定給は半角数字で入力してください`);
    }

    if (values.transportationExpensesText && !halfWidthNumber.test(values.transportationExpensesText)) {
      errors.push(`${rowNumber}行目：通勤手当は半角数字で入力してください`);
    }

    return errors;
  }

  private toTimestamp(value: string): Timestamp | null {
    if (!value) return null;

    const date = new Date(`${value.replace(/\//g, '-')}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
  }

  private toNumber(value: string): number | null {
    if (!value) return null;

    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  private createOfficeIdByNameMap(): Record<string, string> {
    const officeNameMap = this.officeService.allOfficeNameMap();
    const officeIdByNameMap: Record<string, string> = {};

    for (const [officeId, officeName] of Object.entries(officeNameMap)) {
      const normalizedOfficeName = String(officeName ?? '').trim();
      if (!normalizedOfficeName) continue;

      officeIdByNameMap[normalizedOfficeName] = officeId;
    }

    return officeIdByNameMap;
  }
}
