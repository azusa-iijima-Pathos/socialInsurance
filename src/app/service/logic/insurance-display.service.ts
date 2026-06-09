import { Injectable } from '@angular/core';
import { CalculationRun } from '../../model/calculation-run';
import { InsuranceSnapshot } from '../../model/insurance-snapshot';
import { Employee } from '../../model/employee';

export type InsuranceAmountBreakdown = {
  healthInsurance: number;
  nursingCareInsurance: number;
  pensionInsurance: number;
  healthInsuranceForCompany: number;
  nursingCareInsuranceForCompany: number;
  pensionInsuranceForCompany: number;
  healthInsuranceForEmployee: number;
  nursingCareInsuranceForEmployee: number;
  pensionInsuranceForEmployee: number;
  totalInsurance: number;
  totalInsuranceForCompany: number;
  totalInsuranceForEmployee: number;
};

export type InsuranceNoticeSummary = {
  healthInsuranceNotice: number;
  nursingCareInsuranceNotice: number;
  pensionInsuranceNotice: number;
  totalInsuranceNotice: number;
  healthInsuranceForEmployee: number;
  nursingCareInsuranceForEmployee: number;
  pensionInsuranceForEmployee: number;
  totalInsuranceForEmployee: number;
  healthInsuranceForCompany: number;
  nursingCareInsuranceForCompany: number;
  pensionInsuranceForCompany: number;
  totalInsuranceForCompany: number;
};

export type OfficeInsuranceSummary = InsuranceNoticeSummary & {
  officeId: string;
  officeName: string;
};

export type InsuranceDiffTotals = {
  health: number;
  nursing: number;
  pension: number;
};

@Injectable({
  providedIn: 'root',
})
export class InsuranceDisplayService {

  getFiscalYearRange(yearMonth: string): { start: string; end: string; label: string } {
    const [yearText, monthText] = yearMonth.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const fiscalStartYear = month >= 4 ? year : year - 1;
    const start = `${fiscalStartYear}-04`;
    const end = yearMonth;
    return {
      start,
      end,
      label: `${fiscalStartYear}年4月〜${year}年${month}月`,
    };
  }

  enumerateYearMonths(from: string, to: string): string[] {
    const [fromYear, fromMonth] = from.split('-').map(Number);
    const [toYear, toMonth] = to.split('-').map(Number);
    const months: string[] = [];
    let year = fromYear;
    let month = fromMonth;

    while (year * 12 + month <= toYear * 12 + toMonth) {
      months.push(`${year}-${String(month).padStart(2, '0')}`);
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }
    return months;
  }

  getSnapshotBreakdown(snapshot: InsuranceSnapshot | null | undefined): InsuranceAmountBreakdown {
    const payments = snapshot?.insurancePayments ?? [];
    const getPayment = (type: string) => payments.find(item => item.insuranceType === type);

    const health = getPayment('健康保険');
    const nursing = getPayment('介護保険');
    const pension = getPayment('厚生年金');

    const healthInsuranceForEmployee = health?.employeeBurdenAmount ?? 0;
    const healthInsuranceForCompany = health?.companyBurdenAmount ?? 0;
    const nursingCareInsuranceForEmployee = nursing?.employeeBurdenAmount ?? 0;
    const nursingCareInsuranceForCompany = nursing?.companyBurdenAmount ?? 0;
    const pensionInsuranceForEmployee = pension?.employeeBurdenAmount ?? 0;
    const pensionInsuranceForCompany = pension?.companyBurdenAmount ?? 0;

    const healthInsurance = healthInsuranceForEmployee + healthInsuranceForCompany;
    const nursingCareInsurance = nursingCareInsuranceForEmployee + nursingCareInsuranceForCompany;
    const pensionInsurance = pensionInsuranceForEmployee + pensionInsuranceForCompany;

    return this.normalizeBreakdown({
      healthInsurance,
      nursingCareInsurance,
      pensionInsurance,
      healthInsuranceForCompany,
      nursingCareInsuranceForCompany,
      pensionInsuranceForCompany,
      healthInsuranceForEmployee,
      nursingCareInsuranceForEmployee,
      pensionInsuranceForEmployee,
      totalInsurance: healthInsurance + nursingCareInsurance + pensionInsurance,
      totalInsuranceForCompany: healthInsuranceForCompany + nursingCareInsuranceForCompany + pensionInsuranceForCompany,
      totalInsuranceForEmployee: healthInsuranceForEmployee + nursingCareInsuranceForEmployee + pensionInsuranceForEmployee,
    });
  }

  getSnapshotTotals(snapshot: InsuranceSnapshot | null | undefined): InsuranceDiffTotals {
    const breakdown = this.getSnapshotBreakdown(snapshot);
    return {
      health: breakdown.healthInsurance,
      nursing: breakdown.nursingCareInsurance,
      pension: breakdown.pensionInsurance,
    };
  }

  sumDifferenceAdjustments(
    runs: CalculationRun[],
    employeeId: string,
    payrollId: string,
  ): InsuranceDiffTotals {
    return runs
      .filter(run => run.type === '差額調整')
      .filter(run => String(run.payload?.['employeeId'] ?? run.targetEmployeeIds ?? '') === employeeId)
      .filter(run => String(run.payload?.['payrollId'] ?? '') === payrollId)
      .reduce<InsuranceDiffTotals>((total, run) => ({
        health: total.health + Number(run.payload?.['healthDiff'] ?? 0),
        nursing: total.nursing + Number(run.payload?.['nursingDiff'] ?? 0),
        pension: total.pension + Number(run.payload?.['pensionDiff'] ?? 0),
      }), { health: 0, nursing: 0, pension: 0 });
  }

  applyDifferenceAdjustments(
    breakdown: InsuranceAmountBreakdown,
    diffs: InsuranceDiffTotals,
  ): InsuranceAmountBreakdown {
    const health = this.applyTotalDiff(
      breakdown.healthInsurance,
      breakdown.healthInsuranceForCompany,
      breakdown.healthInsuranceForEmployee,
      diffs.health,
    );
    const nursing = this.applyTotalDiff(
      breakdown.nursingCareInsurance,
      breakdown.nursingCareInsuranceForCompany,
      breakdown.nursingCareInsuranceForEmployee,
      diffs.nursing,
    );
    const pension = this.applyTotalDiff(
      breakdown.pensionInsurance,
      breakdown.pensionInsuranceForCompany,
      breakdown.pensionInsuranceForEmployee,
      diffs.pension,
    );

    return this.normalizeBreakdown({
      healthInsurance: health.total,
      nursingCareInsurance: nursing.total,
      pensionInsurance: pension.total,
      healthInsuranceForCompany: health.company,
      nursingCareInsuranceForCompany: nursing.company,
      pensionInsuranceForCompany: pension.company,
      healthInsuranceForEmployee: health.employee,
      nursingCareInsuranceForEmployee: nursing.employee,
      pensionInsuranceForEmployee: pension.employee,
      totalInsurance: health.total + nursing.total + pension.total,
      totalInsuranceForCompany: health.company + nursing.company + pension.company,
      totalInsuranceForEmployee: health.employee + nursing.employee + pension.employee,
    });
  }

  getAdjustedSnapshotBreakdown(
    snapshot: InsuranceSnapshot | null | undefined,
    runs: CalculationRun[],
    employeeId: string,
    payrollId: string,
  ): InsuranceAmountBreakdown {
    const confirmed = this.getSnapshotBreakdown(snapshot);
    const diffs = this.sumDifferenceAdjustments(runs, employeeId, payrollId);
    return this.applyDifferenceAdjustments(confirmed, diffs);
  }

  getAdjustedGrade(
    snapshot: InsuranceSnapshot | null | undefined,
    runs: CalculationRun[],
    employeeId: string,
    payrollId: string,
  ): number {
    let grade = Number(snapshot?.grade ?? 0);
    for (const run of runs) {
      if (run.type !== '差額調整') continue;
      if (String(run.payload?.['employeeId'] ?? run.targetEmployeeIds ?? '') !== employeeId) continue;
      if (String(run.payload?.['payrollId'] ?? '') !== payrollId) continue;

      const comparison = run.payload?.['comparison'] as { grade?: number } | undefined;
      const comparisonGrade = Number(comparison?.grade ?? 0);
      if (comparisonGrade > 0) {
        grade = comparisonGrade;
      }
    }
    return grade;
  }

  getAdjustedSnapshotTotals(
    snapshot: InsuranceSnapshot | null | undefined,
    runs: CalculationRun[],
    employeeId: string,
    payrollId: string,
  ): InsuranceDiffTotals {
    const adjusted = this.getAdjustedSnapshotBreakdown(snapshot, runs, employeeId, payrollId);
    return {
      health: adjusted.healthInsurance,
      nursing: adjusted.nursingCareInsurance,
      pension: adjusted.pensionInsurance,
    };
  }

  summarizeRows(rows: Pick<
    InsuranceAmountBreakdown,
    | 'healthInsurance'
    | 'nursingCareInsurance'
    | 'pensionInsurance'
    | 'healthInsuranceForEmployee'
    | 'nursingCareInsuranceForEmployee'
    | 'pensionInsuranceForEmployee'
    | 'totalInsurance'
  >[]): InsuranceNoticeSummary {
    const healthInsuranceNotice = Math.floor(rows.reduce((total, item) => total + item.healthInsurance, 0));
    const nursingCareInsuranceNotice = Math.floor(rows.reduce((total, item) => total + item.nursingCareInsurance, 0));
    const pensionInsuranceNotice = Math.floor(rows.reduce((total, item) => total + item.pensionInsurance, 0));
    const totalInsuranceNotice = Math.floor(rows.reduce((total, item) => total + item.totalInsurance, 0));
    const healthInsuranceForEmployee = rows.reduce((total, item) => total + item.healthInsuranceForEmployee, 0);
    const nursingCareInsuranceForEmployee = rows.reduce((total, item) => total + item.nursingCareInsuranceForEmployee, 0);
    const pensionInsuranceForEmployee = rows.reduce((total, item) => total + item.pensionInsuranceForEmployee, 0);
    const totalInsuranceForEmployee = healthInsuranceForEmployee + nursingCareInsuranceForEmployee + pensionInsuranceForEmployee;

    return {
      healthInsuranceNotice,
      nursingCareInsuranceNotice,
      pensionInsuranceNotice,
      totalInsuranceNotice,
      healthInsuranceForEmployee,
      nursingCareInsuranceForEmployee,
      pensionInsuranceForEmployee,
      totalInsuranceForEmployee,
      healthInsuranceForCompany: healthInsuranceNotice - healthInsuranceForEmployee,
      nursingCareInsuranceForCompany: nursingCareInsuranceNotice - nursingCareInsuranceForEmployee,
      pensionInsuranceForCompany: pensionInsuranceNotice - pensionInsuranceForEmployee,
      totalInsuranceForCompany: totalInsuranceNotice - totalInsuranceForEmployee,
    };
  }

  buildOfficeSummaries<T extends InsuranceAmountBreakdown & { employeeId: string }>(
    rows: T[],
    employees: Employee[],
    officeNameMap: Record<string, string>,
  ): OfficeInsuranceSummary[] {
    const employeeOfficeMap = new Map(
      employees.map(employee => [employee.employeeId, employee.employmentContract?.officeId ?? '']),
    );
    const grouped = new Map<string, T[]>();

    for (const row of rows) {
      const officeId = employeeOfficeMap.get(row.employeeId) ?? '';
      const current = grouped.get(officeId) ?? [];
      current.push(row);
      grouped.set(officeId, current);
    }

    return [...grouped.entries()]
      .map(([officeId, officeRows]) => ({
        officeId,
        officeName: officeNameMap[officeId] ?? (officeId || '未設定'),
        ...this.summarizeRows(officeRows),
      }))
      .sort((left, right) => left.officeName.localeCompare(right.officeName, 'ja'));
  }

  private applyTotalDiff(
    total: number,
    company: number,
    employee: number,
    diff: number,
  ): { total: number; company: number; employee: number } {
    const newTotal = this.roundAmount(total + diff);
    if (newTotal === 0) {
      return { total: 0, company: 0, employee: 0 };
    }
    if (total === 0) {
      const half = this.roundAmount(newTotal / 2);
      return { total: newTotal, company: half, employee: newTotal - half };
    }

    const companyRatio = company / total;
    const newCompany = this.roundAmount(newTotal * companyRatio);
    const newEmployee = this.roundAmount(newTotal - newCompany);
    return { total: newTotal, company: newCompany, employee: newEmployee };
  }

  private normalizeBreakdown(breakdown: InsuranceAmountBreakdown): InsuranceAmountBreakdown {
    return {
      healthInsurance: this.roundAmount(breakdown.healthInsurance),
      nursingCareInsurance: this.roundAmount(breakdown.nursingCareInsurance),
      pensionInsurance: this.roundAmount(breakdown.pensionInsurance),
      healthInsuranceForCompany: this.roundAmount(breakdown.healthInsuranceForCompany),
      nursingCareInsuranceForCompany: this.roundAmount(breakdown.nursingCareInsuranceForCompany),
      pensionInsuranceForCompany: this.roundAmount(breakdown.pensionInsuranceForCompany),
      healthInsuranceForEmployee: this.roundAmount(breakdown.healthInsuranceForEmployee),
      nursingCareInsuranceForEmployee: this.roundAmount(breakdown.nursingCareInsuranceForEmployee),
      pensionInsuranceForEmployee: this.roundAmount(breakdown.pensionInsuranceForEmployee),
      totalInsurance: this.roundAmount(breakdown.totalInsurance),
      totalInsuranceForCompany: this.roundAmount(breakdown.totalInsuranceForCompany),
      totalInsuranceForEmployee: this.roundAmount(breakdown.totalInsuranceForEmployee),
    };
  }

  private roundAmount(amount: number): number {
    return Math.round((Number(amount) || 0) * 100) / 100;
  }
}
