import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import Papa from 'papaparse';
import { EmployeeInsurance, InsuranceDetail } from '../../model/employee';
import { EmployeeService } from '../Firestore/employee-service';
import { UPDATE_MESSAGES } from '../../constants/constants';
import { DependentService } from '../Firestore/dependent-service';
import { Dependent } from '../../model/dependent';

type InsuranceName = 'healthInsurance' | 'nursingCareInsurance' | 'employeePensionInsurance';
type InsuranceCsvStatus = 'joined' | 'notJoined' | 'lost';
type CsvRow = Record<string, unknown>;

type InsuranceCsvKey =
  | 'employeeId'
  | 'currentGrade'
  | 'basicPensionNumber'
  | 'healthInsuranceJoined'
  | 'healthInsuranceNumber'
  | 'healthInsuranceAcquiredDate'
  | 'healthInsuranceLostDate'
  | 'healthInsuranceCompanyBurdenRate'
  | 'nursingCareInsuranceJoined'
  | 'nursingCareInsuranceAcquiredDate'
  | 'nursingCareInsuranceLostDate'
  | 'nursingCareInsuranceCompanyBurdenRate'
  | 'employeePensionInsuranceJoined'
  | 'employeePensionInsuranceNumber'
  | 'employeePensionInsuranceAcquiredDate'
  | 'employeePensionInsuranceLostDate'
  | 'employeePensionInsuranceCompanyBurdenRate';

export type CsvInsurancePreviewRow = {
  rowNumber: number;
  selected: boolean;
  canRegister: boolean;
  errors: string[];
  employeeId: string;
  currentGrade?: number;
  insurance?: Partial<EmployeeInsurance>;
  healthInsuranceJoined: string;
  nursingCareInsuranceJoined: string;
  employeePensionInsuranceJoined: string;
};

export type CsvInsurancePreviewResult = {
  message: string;
  errors: string[];
  rows: CsvInsurancePreviewRow[];
};

export type CsvInsuranceImportResult = {
  message: string;
  errors: string[];
};

@Injectable({
  providedIn: 'root',
})
export class AddInsuranceCsv {

  private employeeService = inject(EmployeeService);
  private dependentService = inject(DependentService);

  private readonly headers: Record<InsuranceCsvKey, string> = {
    employeeId: '社員ID（半角英数字）',
    currentGrade: '標準報酬等級',
    healthInsuranceJoined: '健康保険加入（1:加入 0:未加入 2:喪失）',
    healthInsuranceNumber: '健康保険番号',
    healthInsuranceAcquiredDate: '健康保険取得日（yyyy-mm-dd）',
    healthInsuranceLostDate: '健康保険喪失日（yyyy-mm-dd）',
    healthInsuranceCompanyBurdenRate: '健康保険会社負担率',
    nursingCareInsuranceJoined: '介護保険加入（1:加入 0:未加入 2:喪失）',
    nursingCareInsuranceAcquiredDate: '介護保険取得日（yyyy-mm-dd）',
    nursingCareInsuranceLostDate: '介護保険喪失日（yyyy-mm-dd）',
    nursingCareInsuranceCompanyBurdenRate: '介護保険会社負担率',
    employeePensionInsuranceJoined: '厚生年金加入（1:加入 0:未加入 2:喪失）',
    employeePensionInsuranceNumber: '厚生年金番号',
    employeePensionInsuranceAcquiredDate: '厚生年金取得日（yyyy-mm-dd）',
    employeePensionInsuranceLostDate: '厚生年金喪失日（yyyy-mm-dd）',
    employeePensionInsuranceCompanyBurdenRate: '厚生年金会社負担率',
    basicPensionNumber: '基礎年金番号',
  };

  createCsvTemplate() {
    const headers = Object.values(this.headers);
    return [
      headers.join(','),
      'E001,10,1,H12345,2026-04-01,,50,0,,,,,1,H12345,2026-04-01,,50,B12345',
      '入力内容）',
      '',
    ].join('\r\n');
  }

  async previewCsv(file: File): Promise<CsvInsurancePreviewResult> {
    const result = await this.parseCsv(file);
    const csvHeaders = (result.meta.fields ?? []).map(header => this.normalizeCsvHeader(String(header ?? '')));
    const expectedHeaders = Object.values(this.headers);
    const hasAllHeaders = expectedHeaders.every(header => csvHeaders.includes(header));

    if (!hasAllHeaders) {
      return {
        message: 'CSVの列がひな形と一致していません',
        errors: [`読み取った列：${csvHeaders.join('、')}`],
        rows: [],
      };
    }

    const rowInfos = result.data.map((row, index) => ({ row: this.normalizeCsvRow(row), rowNumber: index + 2 }));
    const inputStartIndex = rowInfos.findIndex(rowInfo => this.isInputGuideRow(rowInfo.row));
    const parseErrorMap = this.createParseErrorMap(result.errors, inputStartIndex);
    const importRowInfos = (inputStartIndex >= 0 ? rowInfos.slice(inputStartIndex + 1) : rowInfos)
      .filter(rowInfo => !this.isInputGuideRow(rowInfo.row))
      .filter(rowInfo => this.getRowValues(rowInfo.row).some(value => String(value ?? '').trim()));

    if (!importRowInfos.length) {
      return {
        message: 'CSVに取り込み対象のデータがありません',
        errors: [],
        rows: [],
      };
    }

    let employeeNameMap: Record<string, string> = {};
    try {
      await this.employeeService.getAllEmployees();
      employeeNameMap = this.employeeService.allEmployeeNameMap();
    } catch (error) {
      console.error(error);
    }
    const csvEmployeeIds = new Set<string>();
    const previewRows: CsvInsurancePreviewRow[] = [];

    for (const { row, rowNumber } of importRowInfos) {
      const errors: string[] = [...(parseErrorMap.get(rowNumber) ?? [])];
      let employeeId = '';
      let currentGrade: number | null = null;
      let insurance: Partial<EmployeeInsurance> | undefined;
      let healthInsuranceJoined = '';
      let nursingCareInsuranceJoined = '';
      let employeePensionInsuranceJoined = '';

      try {
        if (this.getRowValues(row).some(value => /[^\x00-\x7F]/.test(String(value ?? '')))) {
          errors.push(`${rowNumber}行目：半角で入力してください`);
        }
        employeeId = this.getCsvValue(row, 'employeeId');
        const currentGradeText = this.getCsvValue(row, 'currentGrade');
        healthInsuranceJoined = this.getCsvValue(row, 'healthInsuranceJoined');
        nursingCareInsuranceJoined = this.getCsvValue(row, 'nursingCareInsuranceJoined');
        employeePensionInsuranceJoined = this.getCsvValue(row, 'employeePensionInsuranceJoined');
        currentGrade = this.toNumber(currentGradeText);
        const healthStatus = this.toInsuranceStatus(healthInsuranceJoined);
        const nursingStatus = this.toInsuranceStatus(nursingCareInsuranceJoined);
        const pensionStatus = this.toInsuranceStatus(employeePensionInsuranceJoined);

        if (!employeeId) errors.push(`${rowNumber}行目：社員IDが未入力です`);
        if (employeeId && !/^[a-zA-Z0-9]+$/.test(employeeId)) errors.push(`${rowNumber}行目：社員IDは半角英数字で入力してください`);
        if (employeeId && /^[a-zA-Z0-9]+$/.test(employeeId) && !employeeNameMap[employeeId]) errors.push(`${rowNumber}行目：社員IDが存在しません`);
        if (employeeId && csvEmployeeIds.has(employeeId)) errors.push(`${rowNumber}行目：社員ID ${employeeId} がCSV内で重複しています`);
        if (employeeId) csvEmployeeIds.add(employeeId);

        if (!currentGradeText) errors.push(`${rowNumber}行目：標準報酬等級が未入力です`);
        if (currentGradeText && currentGrade === null) errors.push(`${rowNumber}行目：標準報酬等級は数値で入力してください`);
        if (currentGrade !== null && (currentGrade < 0 || currentGrade > 50)) errors.push(`${rowNumber}行目：標準報酬等級は0以上50以下で入力してください`);
        if (healthStatus !== 'joined' && (nursingStatus === 'joined' || pensionStatus === 'joined')) {
          errors.push(`${rowNumber}行目：健康保険が未加入または喪失の場合、介護保険と厚生年金は加入にできません`);
        }

        insurance = currentGrade === null
          ? undefined
          : this.toInsuranceFromCsvRow(row, rowNumber, this.getCurrentGradeForSave(currentGrade, healthStatus, nursingStatus, pensionStatus), errors);
      } catch (error) {
        console.error(error);
        errors.push(`${rowNumber}行目：CSV内容の確認に失敗しました`);
      }

      previewRows.push({
        rowNumber,
        selected: errors.length === 0,
        canRegister: errors.length === 0,
        errors,
        employeeId,
        currentGrade: currentGrade ?? undefined,
        insurance: errors.length === 0 ? insurance : undefined,
        healthInsuranceJoined,
        nursingCareInsuranceJoined,
        employeePensionInsuranceJoined,
      });
    }

    const errorCount = previewRows.filter(row => row.errors.length > 0).length;
    return {
      message: `CSV確認完了：登録可能 ${previewRows.length - errorCount} 件、エラー ${errorCount} 件`,
      errors: [],
      rows: previewRows,
    };
  }

  async registerPreviewRows(rows: CsvInsurancePreviewRow[]): Promise<CsvInsuranceImportResult> {
    const selectedRows = rows.filter(row => row.selected && row.canRegister && row.insurance);
    if (!selectedRows.length) {
      return { message: '登録対象の行を選択してください', errors: [] };
    }

    const errors: string[] = [];
    let successCount = 0;
    for (const row of selectedRows) {
      try {
        const result = await this.employeeService.updateEmployeeInsurance(row.employeeId, row.insurance!);
        if (result) {
          if (!row.insurance!.healthInsurance?.joined) {
            const dependentsUpdated = await this.updateDependentsToNotDependent(row.employeeId);
            if (!dependentsUpdated) {
              errors.push(`${row.rowNumber}行目：社員ID ${row.employeeId} の扶養情報更新に失敗しました`);
              continue;
            }
          }
          successCount++;
        } else {
          errors.push(`${row.rowNumber}行目：社員ID ${row.employeeId} の保険情報登録に失敗しました`);
        }
      } catch (error) {
        console.error(error);
        errors.push(`${row.rowNumber}行目：社員ID ${row.employeeId} の保険情報登録に失敗しました`);
      }
    }

    await this.employeeService.getAllEmployees(true);
    return {
      message: errors.length
        ? `登録完了：${successCount} 件、失敗 ${errors.length} 件`
        : `保険情報を${UPDATE_MESSAGES.SUCCESS}：${successCount} 件`,
      errors,
    };
  }

  private toInsuranceFromCsvRow(row: CsvRow, rowNumber: number, currentGrade: number, errors: string[]): Partial<EmployeeInsurance> {
    const healthInsurance = this.toInsuranceDetail(row, rowNumber, 'healthInsurance', '健康保険', errors);
    const healthInsuranceNumber = healthInsurance.number ?? '';
    const nursingCareInsurance = this.toInsuranceDetail(
      row,
      rowNumber,
      'nursingCareInsurance',
      '介護保険',
      errors,
      healthInsuranceNumber,
    );
    const employeePensionInsurance = this.toInsuranceDetail(
      row,
      rowNumber,
      'employeePensionInsurance',
      '厚生年金',
      errors,
      healthInsuranceNumber,
    );
    const basicPensionNumber = this.getCsvValue(row, 'basicPensionNumber');
    if (basicPensionNumber && !/^[a-zA-Z0-9]+$/.test(basicPensionNumber)) {
      errors.push(`${rowNumber}行目：基礎年金番号は半角英数字で入力してください`);
    }

    return {
      currentGrade,
      ...(basicPensionNumber ? { basicPensionNumber } : {}),
      healthInsurance,
      nursingCareInsurance,
      employeePensionInsurance,
    };
  }

  private toInsuranceDetail(
    row: CsvRow,
    rowNumber: number,
    insuranceName: InsuranceName,
    label: string,
    errors: string[],
    sharedHealthInsuranceNumber = '',
  ): InsuranceDetail {
    const joinedText = this.getCsvValue(row, `${insuranceName}Joined`);
    const status = this.toInsuranceStatus(joinedText);
    const needsInsuranceDetail = status === 'joined' || status === 'lost';
    const needsLostDate = status === 'lost';
    let number = insuranceName === 'nursingCareInsurance'
      ? sharedHealthInsuranceNumber
      : this.getCsvValue(row, `${insuranceName}Number`);
    if (insuranceName === 'employeePensionInsurance' && !number && sharedHealthInsuranceNumber) {
      number = sharedHealthInsuranceNumber;
    }
    const acquiredDateText = this.getCsvValue(row, `${insuranceName}AcquiredDate`);
    const lostDateText = this.getCsvValue(row, `${insuranceName}LostDate`);
    const companyBurdenRateText = this.getCsvValue(row, `${insuranceName}CompanyBurdenRate`);
    const companyBurdenRate = this.toNumber(companyBurdenRateText);
    const acquiredDate = this.toTimestamp(acquiredDateText);
    const lostDate = this.toTimestamp(lostDateText);

    if (joinedText === '') errors.push(`${rowNumber}行目：${label}加入有無が未入力です`);
    const isStatusValid = !joinedText || this.validateCsvChoice(rowNumber, `${label}加入有無`, joinedText, ['1', '0', '2'], errors);
    if (!isStatusValid) return { joined: false };

    if (needsInsuranceDetail) {
      const numberLabel = insuranceName === 'nursingCareInsurance'
        ? '健康保険番号（介護保険と共通）'
        : `${label}番号`;
      if (status === 'lost' && !number) errors.push(`${rowNumber}行目：${numberLabel}が未入力です`);
      if (number && !/^[a-zA-Z0-9]+$/.test(number)) errors.push(`${rowNumber}行目：${numberLabel}は半角英数字で入力してください`);
      if (!acquiredDateText) errors.push(`${rowNumber}行目：${label}取得日が未入力です`);
      if (acquiredDateText && !acquiredDate) errors.push(`${rowNumber}行目：${label}取得日の日付形式が正しくありません`);
      if (needsLostDate && !lostDateText) errors.push(`${rowNumber}行目：${label}喪失日が未入力です`);
      if (lostDateText && !lostDate) errors.push(`${rowNumber}行目：${label}喪失日の日付形式が正しくありません`);
      if (acquiredDateText && lostDateText && acquiredDateText >= lostDateText) errors.push(`${rowNumber}行目：${label}喪失日は取得日より後の日付で入力してください`);
      if (!companyBurdenRateText) errors.push(`${rowNumber}行目：${label}会社負担率が未入力です`);
      if (companyBurdenRateText && companyBurdenRate === null) errors.push(`${rowNumber}行目：${label}会社負担率は数値で入力してください`);
      if (companyBurdenRate !== null && (companyBurdenRate < 0 || companyBurdenRate > 100)) errors.push(`${rowNumber}行目：${label}会社負担率は0以上100以下で入力してください`);
    }

    if (!needsInsuranceDetail) {
      return { joined: false };
    }

    return {
      joined: status === 'joined',
      number,
      ...(acquiredDate ? { acquiredDate } : {}),
      ...(lostDate ? { lostDate } : {}),
      companyBurdenRate: companyBurdenRate ?? 50,
    };
  }

  private getCurrentGradeForSave(
    currentGrade: number,
    healthStatus: InsuranceCsvStatus | null,
    nursingStatus: InsuranceCsvStatus | null,
    pensionStatus: InsuranceCsvStatus | null,
  ): number {
    return healthStatus === 'notJoined' && nursingStatus === 'notJoined' && pensionStatus === 'notJoined'
      ? 0
      : currentGrade;
  }

  private async updateDependentsToNotDependent(employeeId: string): Promise<boolean> {
    const dependents = await this.dependentService.getDependents(employeeId);
    const activeDependents = dependents.filter(dependent => dependent.isDependent !== false);
    if (activeDependents.length === 0) return true;

    const updates: Partial<Dependent>[] = activeDependents.map(dependent => ({
      ...dependent,
      isDependent: false,
    }));
    return await this.dependentService.updateDependents(employeeId, updates);
  }

  private parseCsv(file: File): Promise<Papa.ParseResult<CsvRow>> {
    return new Promise((resolve, reject) => {
      Papa.parse<CsvRow>(file, {
        header: true,
        skipEmptyLines: true,
        complete: result => resolve(result),
        error: error => reject(error),
      });
    });
  }

  private createParseErrorMap(errors: Papa.ParseError[], inputStartIndex: number) {
    const parseErrorMap = new Map<number, string[]>();
    for (const error of errors) {
      if (error.row === undefined) continue;

      const rowNumber = error.row + 2;
      const dataIndex = error.row;
      if (inputStartIndex >= 0 && dataIndex <= inputStartIndex) continue;

      const messages = parseErrorMap.get(rowNumber) ?? [];
      messages.push(`${rowNumber}行目：未入力の項目があります`);
      parseErrorMap.set(rowNumber, messages);
    }
    return parseErrorMap;
  }

  private getCsvValue(row: CsvRow, key: InsuranceCsvKey) {
    const value = Object.entries(this.normalizeCsvRow(row)).find(([header]) => this.normalizeCsvHeader(header) === this.headers[key])?.[1];
    return String(value ?? '').trim();
  }

  private isInputGuideRow(row: CsvRow) {
    return this.getRowValues(row).some(value => String(value ?? '').trim().replace(/,+$/, '').startsWith('入力内容'));
  }

  private normalizeCsvRow(row: CsvRow | null | undefined): CsvRow {
    return row && typeof row === 'object' ? row : {};
  }

  private getRowValues(row: CsvRow) {
    return Object.values(this.normalizeCsvRow(row)).flatMap(value => Array.isArray(value) ? value : [value]);
  }

  private normalizeCsvHeader(header: string) {
    return header.replace(/^\uFEFF/, '').trim();
  }

  private toInsuranceStatus(value: string): InsuranceCsvStatus | null {
    if (value === '1') return 'joined';
    if (value === '0') return 'notJoined';
    if (value === '2') return 'lost';
    return null;
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

  private toNumber(value: string): number | null {
    if (!value) return null;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
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
  
}
