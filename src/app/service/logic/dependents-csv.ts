import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import Papa from 'papaparse';
import { Dependent } from '../../model/dependent';
import { Employee } from '../../model/employee';
import { EmployeeService } from '../Firestore/employee-service';
import { DependentService } from '../Firestore/dependent-service';
import { ValidationService } from '../common/validation-service';
import { Relationship, CohabitationType, DisabilityType, StudentType } from '../../constants/model-constants';

type DependentCsvKey =
  | 'employeeId'
  | 'name'
  | 'birthDate'
  | 'relationship'
  | 'cohabitationType'
  | 'annualIncome'
  | 'occupation'
  | 'hasDisability'
  | 'disabilityType'
  | 'isStudent'
  | 'studentType'
  | 'isDependent'
  | 'dependentStartDate'
  | 'dependentEndDate';

type CsvRow = Record<string, unknown>;

export type CsvDependentPreviewRow = {
  rowNumber: number;
  selected: boolean;
  canRegister: boolean;
  errors: string[];
  employeeId: string;
  name: string;
  isDependentText: string;
  dependentStartDate: string;
  dependentEndDate: string;
  dependentData?: Partial<Dependent>;
};

export type CsvDependentPreviewResult = {
  message: string;
  rows: CsvDependentPreviewRow[];
};

@Injectable({
  providedIn: 'root',
})
export class DependentsCsvService {

  private employeeService = inject(EmployeeService);
  private dependentService = inject(DependentService);
  private validationService = inject(ValidationService);

  private readonly headers: Record<DependentCsvKey, string> = {
    employeeId: '社員ID（半角英数字）',
    name: '扶養者名前',
    birthDate: '生年月日（yyyy-mm-dd）',
    relationship: '続柄',
    cohabitationType: '同居・別居区分（同居/別居）',
    annualIncome: '収入額（年収見込み）',
    occupation: '職業',
    hasDisability: '障害有無（1:あり 0:なし）',
    disabilityType: '障害区分（一般/特別/重度）',
    isStudent: '学生有無（1:あり 0:なし）',
    studentType: '学生区分（高校生/大学生/その他）',
    isDependent: '扶養状況（1:扶養 0:扶養外）',
    dependentStartDate: '扶養開始日（yyyy-mm-dd）',
    dependentEndDate: '扶養終了日（yyyy-mm-dd）',
  };

  createCsvTemplate(): string {
    const headers = Object.values(this.headers);
    return [
      headers.join(','),
      'E001,山田花子,2015-08-15,子,同居,0,小学生,0,,0,,1,2024-04-01,',
      'E001,山田次郎,2018-03-22,子,同居,0,幼稚園児,1,一般,0,,1,2024-04-01,',
      '入力内容）',
      '',
    ].join('\r\n');
  }

  async previewCsv(file: File): Promise<CsvDependentPreviewResult> {
    const parseResult = await new Promise<Papa.ParseResult<CsvRow>>((resolve, reject) => {
      Papa.parse<CsvRow>(file, {
        header: true,
        skipEmptyLines: true,
        complete: res => resolve(res),
        error: err => reject(err),
      });
    });

    const csvHeaders = (parseResult.meta.fields ?? []).map(h => h.replace(/^\uFEFF/, '').trim());
    const expectedHeaders = Object.values(this.headers);
    const hasAllHeaders = expectedHeaders.every(h => csvHeaders.includes(h));

    if (!hasAllHeaders) {
      return {
        message: 'CSVの列がひな形と一致していません',
        rows: [
          {
            rowNumber: 1,
            selected: false,
            canRegister: false,
            errors: [`読み取った列：${csvHeaders.join('、')}`],
            employeeId: '',
            name: '',
            isDependentText: '',
            dependentStartDate: '',
            dependentEndDate: '',
          },
        ],
      };
    }

    const rowInfos = parseResult.data.map((row, index) => ({ row, rowNumber: index + 2 }));
    const inputStartIndex = rowInfos.findIndex(rowInfo => {
      const values = Object.values(rowInfo.row).flatMap(v => Array.isArray(v) ? v : [v]);
      return values.some(v => String(v ?? '').trim().replace(/,+$/, '').startsWith('入力内容'));
    });

    const importRowInfos = (inputStartIndex >= 0 ? rowInfos.slice(inputStartIndex + 1) : rowInfos)
      .filter(rowInfo => {
        const values = Object.values(rowInfo.row).flatMap(v => Array.isArray(v) ? v : [v]);
        return values.some(v => String(v ?? '').trim().replace(/,+$/, '').startsWith('入力内容') === false);
      })
      .filter(rowInfo => {
        const values = Object.values(rowInfo.row).flatMap(v => Array.isArray(v) ? v : [v]);
        return values.some(v => String(v ?? '').trim());
      });

    if (!importRowInfos.length) {
      return { message: 'CSVに取り込み対象のデータがありません', rows: [] };
    }

    let employeeMap: Record<string, Employee> = {};
    try {
      await this.employeeService.getAllEmployees(true);
      employeeMap = Object.fromEntries(
        this.employeeService.allEmployees().map(employee => [employee.employeeId, employee]),
      );
    } catch (error) {
      console.error(error);
    }

    const uniqueEmployeeIds = new Set<string>();
    for (const { row } of importRowInfos) {
      const employeeId = this.getCsvValue(row, 'employeeId');
      if (employeeId && /^[a-zA-Z0-9]+$/.test(employeeId)) {
        uniqueEmployeeIds.add(employeeId);
      }
    }

    const existingDependentNamesByEmployee = new Map<string, Set<string>>();
    await Promise.all(
      [...uniqueEmployeeIds].map(async employeeId => {
        try {
          const dependents = await this.dependentService.getDependents(employeeId);
          existingDependentNamesByEmployee.set(
            employeeId,
            new Set(dependents.map(dependent => this.normalizeDependentName(dependent.name)).filter(Boolean)),
          );
        } catch (error) {
          console.error(error);
          existingDependentNamesByEmployee.set(employeeId, new Set());
        }
      }),
    );

    const csvDependentKeys = new Set<string>();
    const previewRows: CsvDependentPreviewRow[] = [];

    for (const { row, rowNumber } of importRowInfos) {
      const errors: string[] = [];
      let dependentObject: Partial<Dependent> | undefined;

      try {
        const employeeId = this.getCsvValue(row, 'employeeId');
        const name = this.getCsvValue(row, 'name');
        const birthDateText = this.getCsvValue(row, 'birthDate');
        const relationship = this.getCsvValue(row, 'relationship');
        const cohabitationType = this.getCsvValue(row, 'cohabitationType');
        const annualIncomeText = this.getCsvValue(row, 'annualIncome');
        const occupation = this.getCsvValue(row, 'occupation');
        const hasDisabilityText = this.getCsvValue(row, 'hasDisability');
        const disabilityType = this.getCsvValue(row, 'disabilityType');
        const isStudentText = this.getCsvValue(row, 'isStudent');
        const studentType = this.getCsvValue(row, 'studentType');
        const isDependentText = this.getCsvValue(row, 'isDependent');
        const dependentStartDateText = this.getCsvValue(row, 'dependentStartDate');
        const dependentEndDateText = this.getCsvValue(row, 'dependentEndDate');

        if (!employeeId) errors.push(`${rowNumber}行目：社員IDが未入力です`);
        if (employeeId && !/^[a-zA-Z0-9]+$/.test(employeeId)) errors.push(`${rowNumber}行目：社員IDは半角英数字で入力してください`);
        const employee = employeeId ? employeeMap[employeeId] : undefined;
        if (employeeId && /^[a-zA-Z0-9]+$/.test(employeeId) && !employee) errors.push(`${rowNumber}行目：社員IDが存在しません`);

        if (!name) errors.push(`${rowNumber}行目：扶養者名前が未入力です`);
        if (employeeId && name) {
          const normalizedName = this.normalizeDependentName(name);
          const duplicateKey = `${employeeId}|${normalizedName}`;
          if (csvDependentKeys.has(duplicateKey)) {
            errors.push(`${rowNumber}行目：同じ社員ID・扶養者名がCSV内で重複しています`);
          } else {
            csvDependentKeys.add(duplicateKey);
          }
          const existingNames = existingDependentNamesByEmployee.get(employeeId);
          if (existingNames?.has(normalizedName)) {
            errors.push(`${rowNumber}行目：すでに登録済みです`);
          }
        }
        if (!relationship) errors.push(`${rowNumber}行目：続柄が未入力です`);

        if (!cohabitationType) {
          errors.push(`${rowNumber}行目：同居・別居区分が未入力です`);
        } else if (cohabitationType !== '同居' && cohabitationType !== '別居') {
          errors.push(`${rowNumber}行目：同居・別居区分は「同居」または「別居」で入力してください`);
        }

        let firestoreBirthDate: Timestamp | null = null;
        if (!birthDateText) {
          errors.push(`${rowNumber}行目：生年月日が未入力です`);
        } else {
          const parsedBirthDate = this.parseDateText(birthDateText);
          if (!parsedBirthDate) {
            errors.push(`${rowNumber}行目：生年月日の形式が正しくありません`);
          } else {
            firestoreBirthDate = Timestamp.fromDate(parsedBirthDate);
          }
        }

        const parsedIncome = annualIncomeText ? Number(annualIncomeText) : null;
        if (!annualIncomeText) errors.push(`${rowNumber}行目：収入額（年収見込み）が未入力です`);
        if (annualIncomeText && (parsedIncome === null || !Number.isFinite(parsedIncome) || parsedIncome < 0)) {
          errors.push(`${rowNumber}行目：収入額は0以上の数値で入力してください`);
        }
        if (!occupation) errors.push(`${rowNumber}行目：職業が未入力です`);

        const hasDisability = hasDisabilityText === '1';
        if (hasDisabilityText === '') errors.push(`${rowNumber}行目：障害有無が未入力です`);
        if (hasDisability && !disabilityType) errors.push(`${rowNumber}行目：障害有無が「1:あり」の場合、障害区分は必須です`);
        if (disabilityType && disabilityType !== '一般' && disabilityType !== '特別' && disabilityType !== '重度') {
          errors.push(`${rowNumber}行目：障害区分は「一般」「特別」「重度」のいずれかで入力してください`);
        }

        const isStudent = isStudentText === '1';
        if (isStudentText === '') errors.push(`${rowNumber}行目：学生有無が未入力です`);
        if (isStudent && !studentType) errors.push(`${rowNumber}行目：学生有無が「1:あり」の場合、学生区分は必須です`);
        if (studentType && studentType !== '高校生' && studentType !== '大学生' && studentType !== 'その他') {
          errors.push(`${rowNumber}行目：学生区分は「高校生」「大学生」「その他」のいずれかで入力してください`);
        }

        if (isDependentText === '') {
          errors.push(`${rowNumber}行目：扶養状況が未入力です`);
        } else if (isDependentText !== '1' && isDependentText !== '0') {
          errors.push(`${rowNumber}行目：扶養状況は「1:扶養」または「0:扶養外」で入力してください`);
        }

        const isDependent = isDependentText === '1';
        if (!dependentStartDateText) {
          errors.push(`${rowNumber}行目：扶養開始日が未入力です`);
        } else if (!this.parseDateText(dependentStartDateText)) {
          errors.push(`${rowNumber}行目：扶養開始日の形式が正しくありません`);
        }
        if (!isDependent && !dependentEndDateText) {
          errors.push(`${rowNumber}行目：扶養対象外の場合、扶養終了日は必須です`);
        } else if (dependentEndDateText && !this.parseDateText(dependentEndDateText)) {
          errors.push(`${rowNumber}行目：扶養終了日の形式が正しくありません`);
        }

        if (employee && dependentStartDateText) {
          const periodError = this.validationService.validateDependentPeriod(
            employee.insurance?.healthInsurance,
            {
              isDependent,
              startDate: dependentStartDateText.replace(/\//g, '-'),
              endDate: dependentEndDateText ? dependentEndDateText.replace(/\//g, '-') : undefined,
            },
          );
          if (periodError) errors.push(`${rowNumber}行目：${periodError}`);
        }

        if (errors.length === 0) {
          const startDate = this.parseDateText(dependentStartDateText)!;
          const endDate = dependentEndDateText ? this.parseDateText(dependentEndDateText)! : null;
          dependentObject = {
            name,
            birthDate: firestoreBirthDate!,
            relationship: relationship as Relationship,
            cohabitationType: cohabitationType as CohabitationType,
            annualIncome: parsedIncome ?? 0,
            occupation: occupation.trim(),
            isDependent,
            dependentStartDate: Timestamp.fromDate(startDate),
            ...(endDate ? { dependentEndDate: Timestamp.fromDate(endDate) } : {}),
            hasDisability,
            disabilityType: hasDisability ? disabilityType as DisabilityType : undefined,
            isStudent,
            studentType: isStudent ? studentType as StudentType : undefined,
          };
        }

        previewRows.push({
          rowNumber,
          selected: errors.length === 0,
          canRegister: errors.length === 0,
          errors,
          employeeId,
          name,
          isDependentText: isDependentText === '1' ? '扶養' : isDependentText === '0' ? '扶養外' : '',
          dependentStartDate: dependentStartDateText,
          dependentEndDate: dependentEndDateText,
          dependentData: dependentObject,
        });
      } catch (error) {
        console.error(error);
        previewRows.push({
          rowNumber,
          selected: false,
          canRegister: false,
          errors: [`${rowNumber}行目：CSV内容の確認に失敗しました`],
          employeeId: '',
          name: '',
          isDependentText: '',
          dependentStartDate: '',
          dependentEndDate: '',
        });
      }
    }

    const errorCount = previewRows.filter(r => r.errors.length > 0).length;
    return {
      message: `扶養CSV確認完了：登録可能 ${previewRows.length - errorCount} 件、エラー ${errorCount} 件`,
      rows: previewRows,
    };
  }

  async registerPreviewRows(rows: CsvDependentPreviewRow[]): Promise<{ success: boolean; message: string }> {
    const validRows = rows.filter(r => r.selected && r.canRegister && r.dependentData);
    if (!validRows.length) return { success: false, message: '登録対象の行を選択してください' };

    let successCount = 0;
    let failureCount = 0;
    const groupedByEmployee: Record<string, Partial<Dependent>[]> = {};
    const existingDependentNamesByEmployee = new Map<string, Set<string>>();

    for (const row of validRows) {
      if (!existingDependentNamesByEmployee.has(row.employeeId)) {
        const dependents = await this.dependentService.getDependents(row.employeeId);
        existingDependentNamesByEmployee.set(
          row.employeeId,
          new Set(dependents.map(dependent => this.normalizeDependentName(dependent.name)).filter(Boolean)),
        );
      }

      const normalizedName = this.normalizeDependentName(row.name);
      const existingNames = existingDependentNamesByEmployee.get(row.employeeId)!;
      if (existingNames.has(normalizedName)) {
        failureCount++;
        continue;
      }

      existingNames.add(normalizedName);
      if (!groupedByEmployee[row.employeeId]) {
        groupedByEmployee[row.employeeId] = [];
      }
      groupedByEmployee[row.employeeId].push(row.dependentData!);
    }

    if (!Object.keys(groupedByEmployee).length) {
      return { success: false, message: '登録対象の行を選択してください' };
    }

    try {
      for (const [employeeId, targetDependents] of Object.entries(groupedByEmployee)) {
        const existingDependents = await this.dependentService.getDependents(employeeId);
        let startIdIndex = existingDependents.length;

        const mergedDependents: Partial<Dependent>[] = targetDependents.map(dep => {
          startIdIndex++;
          return {
            ...dep,
            dependentId: `${startIdIndex}`,
          };
        });

        const isSuccess = await this.dependentService.registerDependents(employeeId, mergedDependents);
        if (isSuccess) successCount += targetDependents.length;
        else failureCount += targetDependents.length;
      }

      if (failureCount > 0) {
        return {
          success: successCount > 0,
          message: `登録完了：${successCount} 件、失敗 ${failureCount} 件`,
        };
      }

      return { success: true, message: `${successCount} 件の扶養情報をシステムに登録しました` };
    } catch (error) {
      console.error(error);
      return { success: false, message: '一括登録処理中にエラーが発生しました' };
    }
  }

  private getCsvValue(row: CsvRow, key: DependentCsvKey): string {
    const found = Object.entries(row).find(([head]) => head.replace(/^\uFEFF/, '').trim() === this.headers[key]);
    return String(found?.[1] ?? '').trim();
  }

  private normalizeDependentName(name?: string): string {
    return (name ?? '').trim();
  }

  private parseDateText(value: string): Date | null {
    const match = value.replace(/\//g, '-').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const dateObj = new Date(y, m - 1, d);
    if (dateObj.getFullYear() === y && dateObj.getMonth() === m - 1 && dateObj.getDate() === d) {
      return dateObj;
    }
    return null;
  }
}
