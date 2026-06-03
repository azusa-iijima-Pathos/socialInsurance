import { Injectable } from '@angular/core';

export type InsuranceConfirmCsvRow = {
  employeeId: string;
  fixedSalary: number;
  actualPaymentAmount: number;
  grade: number;
  healthInsurance: number;
  healthInsuranceForCompany: number;
  healthInsuranceForEmployee: number;
  nursingCareInsurance: number;
  nursingCareInsuranceForCompany: number;
  nursingCareInsuranceForEmployee: number;
  pensionInsurance: number;
  pensionInsuranceForCompany: number;
  pensionInsuranceForEmployee: number;
  totalInsurance: number;
  totalInsuranceForCompany: number;
  totalInsuranceForEmployee: number;
};

export type BonusInsuranceConfirmCsvRow = {
  employeeId: string;
  actualPaymentAmount: number;
  annualStandardBonusAmount: number;
  healthStandardBonusAmount: number;
  pensionStandardBonusAmount: number;
  healthInsurance: number;
  healthInsuranceForCompany: number;
  healthInsuranceForEmployee: number;
  nursingCareInsurance: number;
  nursingCareInsuranceForCompany: number;
  nursingCareInsuranceForEmployee: number;
  pensionInsurance: number;
  pensionInsuranceForCompany: number;
  pensionInsuranceForEmployee: number;
  totalInsurance: number;
  totalInsuranceForCompany: number;
  totalInsuranceForEmployee: number;
};

@Injectable({
  providedIn: 'root',
})
export class InsuranceConfirmCsvService {

  exportInsuranceOnly(rows: InsuranceConfirmCsvRow[], workingYear: number, workingMonth: number) {
    const headers = [
      '従業員ID',
      '健康保険総額',
      '健康保険会社負担',
      '健康保険個人負担',
      '介護保険総額',
      '介護保険会社負担',
      '介護保険個人負担',
      '厚生年金総額',
      '厚生年金会社負担',
      '厚生年金個人負担',
      '合計総額',
      '合計会社負担',
      '合計個人負担',
    ];
    const body = rows.map(row => [
      row.employeeId,
      this.formatAmount(row.healthInsurance),
      this.formatAmount(row.healthInsuranceForCompany),
      row.healthInsuranceForEmployee,
      this.formatAmount(row.nursingCareInsurance),
      this.formatAmount(row.nursingCareInsuranceForCompany),
      row.nursingCareInsuranceForEmployee,
      this.formatAmount(row.pensionInsurance),
      this.formatAmount(row.pensionInsuranceForCompany),
      row.pensionInsuranceForEmployee,
      this.formatAmount(row.totalInsurance),
      this.formatAmount(row.totalInsuranceForCompany),
      row.totalInsuranceForEmployee,
    ]);

    this.downloadCsv(headers, body, `insurance-confirm-${workingYear}-${String(workingMonth).padStart(2, '0')}.csv`);
  }

  exportWithSalary(rows: InsuranceConfirmCsvRow[], workingYear: number, workingMonth: number) {
    const headers = [
      '従業員ID',
      '固定給',
      '総支給額',
      '等級',
      '健康保険総額',
      '健康保険会社負担',
      '健康保険個人負担',
      '介護保険総額',
      '介護保険会社負担',
      '介護保険個人負担',
      '厚生年金総額',
      '厚生年金会社負担',
      '厚生年金個人負担',
      '合計総額',
      '合計会社負担',
      '合計個人負担',
    ];
    const body = rows.map(row => [
      row.employeeId,
      row.fixedSalary,
      row.actualPaymentAmount,
      row.grade,
      this.formatAmount(row.healthInsurance),
      this.formatAmount(row.healthInsuranceForCompany),
      row.healthInsuranceForEmployee,
      this.formatAmount(row.nursingCareInsurance),
      this.formatAmount(row.nursingCareInsuranceForCompany),
      row.nursingCareInsuranceForEmployee,
      this.formatAmount(row.pensionInsurance),
      this.formatAmount(row.pensionInsuranceForCompany),
      row.pensionInsuranceForEmployee,
      this.formatAmount(row.totalInsurance),
      this.formatAmount(row.totalInsuranceForCompany),
      row.totalInsuranceForEmployee,
    ]);

    this.downloadCsv(headers, body, `insurance-confirm-with-salary-${workingYear}-${String(workingMonth).padStart(2, '0')}.csv`);
  }

  exportBonusInsuranceOnly(rows: BonusInsuranceConfirmCsvRow[], payrollId: string) {
    const headers = [
      '従業員ID',
      '健康保険総額',
      '健康保険会社負担',
      '健康保険個人負担',
      '介護保険総額',
      '介護保険会社負担',
      '介護保険個人負担',
      '厚生年金総額',
      '厚生年金会社負担',
      '厚生年金個人負担',
      '合計総額',
      '合計会社負担',
      '合計個人負担',
    ];
    const body = rows.map(row => [
      row.employeeId,
      this.formatAmount(row.healthInsurance),
      this.formatAmount(row.healthInsuranceForCompany),
      row.healthInsuranceForEmployee,
      this.formatAmount(row.nursingCareInsurance),
      this.formatAmount(row.nursingCareInsuranceForCompany),
      row.nursingCareInsuranceForEmployee,
      this.formatAmount(row.pensionInsurance),
      this.formatAmount(row.pensionInsuranceForCompany),
      row.pensionInsuranceForEmployee,
      this.formatAmount(row.totalInsurance),
      this.formatAmount(row.totalInsuranceForCompany),
      row.totalInsuranceForEmployee,
    ]);

    this.downloadCsv(headers, body, `bonus-insurance-confirm-${payrollId}.csv`);
  }

  exportBonusWithSalary(rows: BonusInsuranceConfirmCsvRow[], payrollId: string) {
    const headers = [
      '従業員ID',
      '賞与支給額',
      '年間支給額',
      '健康保険対象額',
      '厚生年金対象額',
      '健康保険総額',
      '健康保険会社負担',
      '健康保険個人負担',
      '介護保険総額',
      '介護保険会社負担',
      '介護保険個人負担',
      '厚生年金総額',
      '厚生年金会社負担',
      '厚生年金個人負担',
      '合計総額',
      '合計会社負担',
      '合計個人負担',
    ];
    const body = rows.map(row => [
      row.employeeId,
      row.actualPaymentAmount,
      row.annualStandardBonusAmount,
      row.healthStandardBonusAmount,
      row.pensionStandardBonusAmount,
      this.formatAmount(row.healthInsurance),
      this.formatAmount(row.healthInsuranceForCompany),
      row.healthInsuranceForEmployee,
      this.formatAmount(row.nursingCareInsurance),
      this.formatAmount(row.nursingCareInsuranceForCompany),
      row.nursingCareInsuranceForEmployee,
      this.formatAmount(row.pensionInsurance),
      this.formatAmount(row.pensionInsuranceForCompany),
      row.pensionInsuranceForEmployee,
      this.formatAmount(row.totalInsurance),
      this.formatAmount(row.totalInsuranceForCompany),
      row.totalInsuranceForEmployee,
    ]);

    this.downloadCsv(headers, body, `bonus-insurance-confirm-with-salary-${payrollId}.csv`);
  }

  private downloadCsv(headers: string[], body: (string | number)[][], fileName: string) {
    const csv = [
      headers,
      ...body,
    ].map(row => row.map(value => this.escapeCsvValue(value)).join(',')).join('\r\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  private escapeCsvValue(value: string | number): string {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  private formatAmount(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
