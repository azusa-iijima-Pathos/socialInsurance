import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CalculationRunService } from '../../../service/Firestore/calculation-run-service';
import { CalculationRun } from '../../../model/calculation-run';
import { CommonService } from '../../../service/common/common-service';
import { CorrectionLogicService } from '../../../service/logic/correction-logic.service';
import { getWorkingYearMonth } from '../../../service/logic/event-id-service';
import { PayrollLockService } from '../../../service/Firestore/payroll-lock-service';
import { RouterLink } from '@angular/router';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { InsuranceDisplayService, InsuranceAmountBreakdown } from '../../../service/logic/insurance-display.service';
import { InsuranceSnapshotService } from '../../../service/Firestore/insurance-snapshot-service';

type BurdenAmounts = {
  base: number;
  diff: number;
  total: number;
};

type InsuranceColumn = {
  employee: BurdenAmounts;
  company: BurdenAmounts;
};

type EmployeeCollectionRow = {
  employeeId: string;
  employeeName: string;
  health: InsuranceColumn;
  nursing: InsuranceColumn;
  pension: InsuranceColumn;
  total: InsuranceColumn;
};

@Component({
  selector: 'app-correction-list',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './correction-list.html',
  styleUrl: './correction-list.css',
})
export class CorrectionList {

  private calculationRunService = inject(CalculationRunService);
  private correctionLogicService = inject(CorrectionLogicService);
  private payrollLockService = inject(PayrollLockService);
  private route = inject(ActivatedRoute);
  commonService = inject(CommonService);
  employeeService = inject(EmployeeService);
  private insuranceDisplayService = inject(InsuranceDisplayService);
  private insuranceSnapshotService = inject(InsuranceSnapshotService);

  monthOptions = this.correctionLogicService.getPastYearMonthOptions(12);
  selectedMonthKey = `${getWorkingYearMonth().year}-${getWorkingYearMonth().month}`;
  bonusPayrollIds: string[] = [];
  selectedBonusPayrollId = '';
  listType: 'all' | 'bonus' = 'all';
  runs: CalculationRun[] = [];
  collectionRows: EmployeeCollectionRow[] = [];
  private allDifferenceRuns: CalculationRun[] = [];

  async ngOnInit() {
    await this.employeeService.getAllEmployees();

    const lockedBonusPayrolls = await this.payrollLockService.getLockedPayrolls('賞与');
    this.bonusPayrollIds = lockedBonusPayrolls.map(lock => lock.payrollId);
    this.selectedBonusPayrollId = this.bonusPayrollIds[0] ?? '';

    this.route.queryParamMap.subscribe(params => {
      this.listType = params.get('type') === 'bonus' ? 'bonus' : 'all';
      void this.loadRuns();
    });
  }

  async onFilterChange() {
    await this.loadRuns();
  }

  get selectedMonthLabel(): string {
    const option = this.monthOptions.find(item => `${item.year}-${item.month}` === this.selectedMonthKey);
    return option?.label ?? this.selectedMonthKey;
  }

  async loadRuns() {
    this.collectionRows = [];
    if (this.listType === 'bonus') {
      const runs = await this.calculationRunService.getAllCalculationRuns();
      this.runs = runs
        .filter(run => run.type === '差額調整')
        .filter(run => run.payload?.['sourceType'] === '賞与修正')
        .filter(run => !this.selectedBonusPayrollId || run.payload?.['payrollId'] === this.selectedBonusPayrollId)
        .sort((left, right) => String(right.runId).localeCompare(String(left.runId)));
      return;
    }

    const [yearText, monthText] = this.selectedMonthKey.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    this.runs = await this.calculationRunService.getDifferenceAdjustmentsByTargetMonth(year, month);
    this.runs = this.runs.filter(run => run.payload?.['sourceType'] !== '賞与修正');
    await this.buildCollectionRows();
  }

  formatSignedDiff(diff: number): string {
    const sign = diff > 0 ? '+' : '';
    return `${sign}${diff.toLocaleString()}円`;
  }

  private async buildCollectionRows() {
    if (this.runs.length === 0) {
      this.collectionRows = [];
      return;
    }

    this.allDifferenceRuns = (await this.calculationRunService.getAllCalculationRuns())
      .filter(run => run.type === '差額調整');

    const employeePayrolls = new Map<string, Set<string>>();
    for (const run of this.runs) {
      const employeeId = this.getEmployeeId(run);
      const payrollId = this.getRunPayrollId(run);
      if (!employeeId || !payrollId) continue;
      if (!employeePayrolls.has(employeeId)) {
        employeePayrolls.set(employeeId, new Set());
      }
      employeePayrolls.get(employeeId)!.add(payrollId);
    }

    const rows: EmployeeCollectionRow[] = [];

    for (const employeeId of [...employeePayrolls.keys()].sort((left, right) => left.localeCompare(right, 'ja'))) {
      const payrollIds = [...employeePayrolls.get(employeeId)!].sort();
      const snapshots = await this.insuranceSnapshotService.getSnapshotsForEmployee(employeeId);
      const snapshotByPayrollId = new Map(
        snapshots.map(snapshot => [String(snapshot.payrollId ?? snapshot.snapshotId ?? ''), snapshot]),
      );

      let health = this.emptyInsuranceColumn();
      let nursing = this.emptyInsuranceColumn();
      let pension = this.emptyInsuranceColumn();
      let hasSnapshot = false;

      for (const payrollId of payrollIds) {
        const snapshot = snapshotByPayrollId.get(payrollId)
          ?? await this.insuranceSnapshotService.getSnapshot(employeeId, payrollId);
        if (!snapshot) continue;

        hasSnapshot = true;
        const confirmed = this.insuranceDisplayService.getSnapshotBreakdown(snapshot);
        const adjusted = this.insuranceDisplayService.getAdjustedSnapshotBreakdown(
          snapshot,
          this.allDifferenceRuns,
          employeeId,
          payrollId,
        );

        health = this.sumInsuranceColumns(health, this.buildInsuranceColumn(confirmed, adjusted, 'health'));
        nursing = this.sumInsuranceColumns(nursing, this.buildInsuranceColumn(confirmed, adjusted, 'nursing'));
        pension = this.sumInsuranceColumns(pension, this.buildInsuranceColumn(confirmed, adjusted, 'pension'));
      }

      if (!hasSnapshot) continue;

      const total = this.sumInsuranceColumns(health, nursing, pension);
      if (!this.hasAnyAmount(total)) continue;

      rows.push({
        employeeId,
        employeeName: this.commonService.getEmployeeName(employeeId) ?? employeeId,
        health,
        nursing,
        pension,
        total,
      });
    }

    this.collectionRows = rows;
  }

  private getRunPayrollId(run: CalculationRun): string {
    const payrollId = String(run.payload?.['payrollId'] ?? '').trim();
    if (payrollId) return payrollId;

    const adjust = run.payload?.['adjustMonth'] as { year?: number; month?: number } | undefined;
    if (adjust?.year && adjust?.month) {
      return this.correctionLogicService.getPayrollId(adjust.year, adjust.month);
    }

    return '';
  }

  private emptyInsuranceColumn(): InsuranceColumn {
    return {
      employee: { base: 0, diff: 0, total: 0 },
      company: { base: 0, diff: 0, total: 0 },
    };
  }

  private buildInsuranceColumn(
    confirmed: InsuranceAmountBreakdown,
    adjusted: InsuranceAmountBreakdown,
    type: 'health' | 'nursing' | 'pension',
  ): InsuranceColumn {
    const values = {
      health: {
        employeeConfirmed: confirmed.healthInsuranceForEmployee,
        employeeAdjusted: adjusted.healthInsuranceForEmployee,
        companyConfirmed: confirmed.healthInsuranceForCompany,
        companyAdjusted: adjusted.healthInsuranceForCompany,
      },
      nursing: {
        employeeConfirmed: confirmed.nursingCareInsuranceForEmployee,
        employeeAdjusted: adjusted.nursingCareInsuranceForEmployee,
        companyConfirmed: confirmed.nursingCareInsuranceForCompany,
        companyAdjusted: adjusted.nursingCareInsuranceForCompany,
      },
      pension: {
        employeeConfirmed: confirmed.pensionInsuranceForEmployee,
        employeeAdjusted: adjusted.pensionInsuranceForEmployee,
        companyConfirmed: confirmed.pensionInsuranceForCompany,
        companyAdjusted: adjusted.pensionInsuranceForCompany,
      },
    }[type];

    return {
      employee: this.buildBurdenAmounts(values.employeeConfirmed, values.employeeAdjusted),
      company: this.buildBurdenAmounts(values.companyConfirmed, values.companyAdjusted),
    };
  }

  private buildBurdenAmounts(confirmed: number, adjusted: number): BurdenAmounts {
    return {
      base: confirmed,
      diff: adjusted - confirmed,
      total: adjusted,
    };
  }

  private sumInsuranceColumns(...columns: InsuranceColumn[]): InsuranceColumn {
    return columns.reduce<InsuranceColumn>((sum, column) => ({
      employee: {
        base: sum.employee.base + column.employee.base,
        diff: sum.employee.diff + column.employee.diff,
        total: sum.employee.total + column.employee.total,
      },
      company: {
        base: sum.company.base + column.company.base,
        diff: sum.company.diff + column.company.diff,
        total: sum.company.total + column.company.total,
      },
    }), {
      employee: { base: 0, diff: 0, total: 0 },
      company: { base: 0, diff: 0, total: 0 },
    });
  }

  private hasAnyAmount(column: InsuranceColumn): boolean {
    return [
      column.employee.base,
      column.employee.diff,
      column.employee.total,
      column.company.base,
      column.company.diff,
      column.company.total,
    ].some(value => value !== 0);
  }

  getEmployeeId(run: CalculationRun): string {
    return String(run.targetEmployeeIds ?? run.payload?.['employeeId'] ?? '');
  }

  getEmployeeName(run: CalculationRun): string {
    const employeeId = this.getEmployeeId(run);
    return this.commonService.getEmployeeName(employeeId) ?? employeeId;
  }

  getSourceType(run: CalculationRun): string {
    return String(run.payload?.['sourceType'] ?? '—');
  }

  getRemark(run: CalculationRun): string {
    return String(run.payload?.['remark'] ?? '');
  }

  getAdjustMonth(run: CalculationRun): string {
    const adjust = run.payload?.['adjustMonth'] as { year?: number; month?: number } | undefined;
    if (!adjust?.year || !adjust?.month) return '—';
    return `${adjust.year}年${adjust.month}月`;
  }

  getGrade(run: CalculationRun): number {
    return Number(this.getComparison(run)?.['grade'] ?? 0);
  }

  getCurrentHealth(run: CalculationRun): number {
    return Number(this.getComparison(run)?.['currentHealth'] ?? 0);
  }

  getNewHealth(run: CalculationRun): number {
    return Number(this.getComparison(run)?.['newHealth'] ?? 0);
  }

  getCurrentNursing(run: CalculationRun): number {
    return Number(this.getComparison(run)?.['currentNursing'] ?? 0);
  }

  getNewNursing(run: CalculationRun): number {
    return Number(this.getComparison(run)?.['newNursing'] ?? 0);
  }

  getCurrentPension(run: CalculationRun): number {
    return Number(this.getComparison(run)?.['currentPension'] ?? 0);
  }

  getNewPension(run: CalculationRun): number {
    return Number(this.getComparison(run)?.['newPension'] ?? 0);
  }

  getCurrentTotal(run: CalculationRun): number {
    return this.getCurrentHealth(run) + this.getCurrentNursing(run) + this.getCurrentPension(run);
  }

  getNewTotal(run: CalculationRun): number {
    return this.getNewHealth(run) + this.getNewNursing(run) + this.getNewPension(run);
  }

  getNursingDiff(run: CalculationRun): number {
    return Number(run.payload?.['nursingDiff'] ?? 0);
  }

  getHealthDiff(run: CalculationRun): number {
    return Number(run.payload?.['healthDiff'] ?? 0);
  }

  getPensionDiff(run: CalculationRun): number {
    return Number(run.payload?.['pensionDiff'] ?? 0);
  }

  getTotalDiff(run: CalculationRun): number {
    return Number(run.payload?.['totalDiff'] ?? 0);
  }

  getBeforeAmount(run: CalculationRun): number {
    return Number(run.payload?.['beforeAmount'] ?? 0);
  }

  getAfterAmount(run: CalculationRun): number {
    return Number(run.payload?.['afterAmount'] ?? 0);
  }

  displayBonusPayrollId(payrollId: string): string {
    return payrollId.replace('_bonus', '');
  }

  private getComparison(run: CalculationRun): Record<string, unknown> | undefined {
    return run.payload?.['comparison'] as Record<string, unknown> | undefined;
  }

  exportCsv() {
    const header = this.listType === 'bonus' ? [
      'employee_id',
      'employee_name',
      'target_month',
      'adjust_month',
      'before_bonus_amount',
      'after_bonus_amount',
      'health_diff',
      'nursing_diff',
      'pension_diff',
      'total_diff',
      'remark',
    ].join(',') : [
      'employee_id',
      'employee_name',
      'target_month',
      'adjust_month',
      'grade',
      'health_diff',
      'nursing_diff',
      'pension_diff',
      'total_diff',
      'remark',
    ].join(',');
    const body = this.runs.map(run => {
      const common = [
        this.escapeCsv(this.getEmployeeId(run)),
        this.escapeCsv(this.getEmployeeName(run)),
        this.escapeCsv(this.getTargetMonth(run)),
        this.escapeCsv(this.getAdjustMonthForCsv(run)),
      ];
      const diffs = [
        this.getHealthDiff(run),
        this.getNursingDiff(run),
        this.getPensionDiff(run),
        this.getTotalDiff(run),
        this.escapeCsv(this.getRemark(run)),
      ];
      return this.listType === 'bonus'
        ? [...common, this.getBeforeAmount(run), this.getAfterAmount(run), ...diffs].join(',')
        : [...common, this.getGrade(run), ...diffs].join(',');
    });
    const csv = [header, ...body].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const suffix = this.listType === 'bonus'
      ? this.displayBonusPayrollId(this.selectedBonusPayrollId)
      : this.selectedMonthKey;
    anchor.download = `difference-adjustments-${suffix}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private getTargetMonth(run: CalculationRun): string {
    const target = run.payload?.['targetMonth'] as { year?: number; month?: number } | undefined;
    if (!target?.year || !target?.month) return '';
    return `${target.year}-${String(target.month).padStart(2, '0')}`;
  }

  private getAdjustMonthForCsv(run: CalculationRun): string {
    const adjust = run.payload?.['adjustMonth'] as { year?: number; month?: number } | undefined;
    if (!adjust?.year || !adjust?.month) return '';
    return `${adjust.year}-${String(adjust.month).padStart(2, '0')}`;
  }

  private escapeCsv(value: string): string {
    if (!/[",\n]/.test(value)) return value;
    return `"${value.replace(/"/g, '""')}"`;
  }
}
