import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CorrectionLogicService, BonusInsuranceComparison, MonthlyInsuranceComparisonRow } from '../../../service/logic/correction-logic.service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { PayrollService } from '../../../service/Firestore/payroll-service';
import { CalculationRunService } from '../../../service/Firestore/calculation-run-service';
import { PayrollLockService } from '../../../service/Firestore/payroll-lock-service';
import { InsuranceSnapshotService } from '../../../service/Firestore/insurance-snapshot-service';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { Payroll } from '../../../model/payroll';
import { Employee } from '../../../model/employee';
import { UPDATE_MESSAGES } from '../../../constants/constants';
import { getWorkingYearMonth } from '../../../service/logic/event-id-service';
import { InsuranceSnapshot } from '../../../model/insurance-snapshot';
import { Router } from '@angular/router';

type BonusCorrectionRow = {
  payroll: Payroll;
  employeeName: string;
  grade: number;
  health: number;
  nursing: number;
  pension: number;
  total: number;
  editing: boolean;
  editAmount: number;
};

@Component({
  selector: 'app-bonus-correction',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './bonus-correction.html',
  styleUrl: './bonus-correction.css',
})
export class BonusCorrection {

  private correctionLogicService = inject(CorrectionLogicService);
  private employeeService = inject(EmployeeService);
  private payrollService = inject(PayrollService);
  private calculationRunService = inject(CalculationRunService);
  private payrollLockService = inject(PayrollLockService);
  private insuranceSnapshotService = inject(InsuranceSnapshotService);
  commonService = inject(CommonService);

  message = '';
  private messageTimer: MessageTimer = null;
  bonusPayrollIds: string[] = [];
  selectedPayrollId = '';
  previewOpen = false;
  previewComparison: BonusInsuranceComparison | null = null;
  pendingPayroll: Partial<Payroll> | null = null;
  pendingOriginalPayroll: Payroll | null = null;
  pendingEmployee: Employee | null = null;
  rows: BonusCorrectionRow[] = [];

  async ngOnInit() {
    await this.employeeService.getAllEmployees();
    const lockedBonusPayrolls = await this.payrollLockService.getLockedPayrolls('賞与');
    this.bonusPayrollIds = lockedBonusPayrolls.map(lock => lock.payrollId);
    this.selectedPayrollId = this.bonusPayrollIds[0] ?? '';
    await this.loadRows();
  }

  async onBonusPayrollIdChange() {
    await this.loadRows();
  }

  async loadRows() {
    this.rows = [];
    if (!this.selectedPayrollId) return;
    await this.payrollService.getAllPayrollListForMonth(this.selectedPayrollId);
    const payrollList = this.payrollService.allPayrollListForMonth()
      .find(item => item.payrollId === this.selectedPayrollId)?.payrollList ?? [];

    for (const payroll of payrollList) {
      const employeeId = payroll.employeeId ?? '';
      const employee = employeeId ? await this.employeeService.getEmployeeByEmployeeId(employeeId) : null;
      const snapshot = employeeId ? await this.insuranceSnapshotService.getSnapshot(employeeId, this.selectedPayrollId) : null;
      const totals = this.getSnapshotTotals(snapshot);
      this.rows.push({
        payroll,
        employeeName: employeeId ? this.commonService.getEmployeeName(employeeId) ?? employeeId : '',
        grade: Number(snapshot?.grade ?? employee?.insurance?.currentGrade ?? 0),
        health: totals.health,
        nursing: totals.nursing,
        pension: totals.pension,
        total: totals.health + totals.nursing + totals.pension,
        editing: false,
        editAmount: payroll.actualPaymentAmount ?? 0,
      });
    }
  }

  startEdit(row: BonusCorrectionRow) {
    row.editing = true;
    row.editAmount = row.payroll.actualPaymentAmount ?? 0;
  }

  cancelEdit(row: BonusCorrectionRow) {
    row.editing = false;
    row.editAmount = row.payroll.actualPaymentAmount ?? 0;
  }

  async confirmInsurance(row: BonusCorrectionRow) {
    const employeeId = row.payroll.employeeId;
    if (!employeeId || !this.selectedPayrollId) return;

    const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    if (!employee) {
      this.showMessage('従業員が見つかりません');
      return;
    }

    const newAmount = Number(row.editAmount ?? 0);
    const comparison = await this.correctionLogicService.calculateBonusInsuranceComparison(
      employee,
      this.selectedPayrollId,
      newAmount,
    );

    if (!comparison) {
      this.showMessage('確定済み賞与の保険料スナップショットが見つかりません');
      return;
    }

    this.pendingPayroll = {
      ...row.payroll,
      actualPaymentAmount: newAmount,
    };
    this.pendingOriginalPayroll = row.payroll;
    this.pendingEmployee = employee;
    this.previewComparison = comparison;
    this.previewOpen = true;
  }

  async approvePreview() {
    if (!this.pendingPayroll || !this.pendingOriginalPayroll || !this.pendingEmployee || !this.previewComparison) return;

    const updated = await this.payrollService.updatePayrollForCorrection(this.pendingPayroll);
    if (!updated) {
      this.showMessage(UPDATE_MESSAGES.FAILED);
      return;
    }

    if (this.previewComparison.totalDiff !== 0) {
      const working = getWorkingYearMonth();
      const row: MonthlyInsuranceComparisonRow = {
        payrollId: this.previewComparison.payrollId,
        year: Number(this.previewComparison.payrollId.slice(0, 4)),
        month: Number(this.previewComparison.payrollId.slice(5, 7)),
        grade: this.pendingEmployee.insurance?.currentGrade ?? 0,
        currentHealth: this.previewComparison.currentHealth,
        currentNursing: this.previewComparison.currentNursing,
        currentPension: this.previewComparison.currentPension,
        newHealth: this.previewComparison.newHealth,
        newNursing: this.previewComparison.newNursing,
        newPension: this.previewComparison.newPension,
        healthDiff: this.previewComparison.healthDiff,
        nursingDiff: this.previewComparison.nursingDiff,
        pensionDiff: this.previewComparison.pensionDiff,
        totalDiff: this.previewComparison.totalDiff,
      };

      await this.calculationRunService.createMonthlyDifferenceAdjustmentRuns(
        this.pendingEmployee.employeeId,
        '賞与修正',
        '賞与遡及反映',
        working,
        [row],
        {
          beforeAmount: this.pendingOriginalPayroll.actualPaymentAmount ?? 0,
          afterAmount: this.pendingPayroll.actualPaymentAmount ?? 0,
          payrollId: this.selectedPayrollId,
        },
      );
    }

    this.previewOpen = false;
    this.pendingPayroll = null;
    this.pendingOriginalPayroll = null;
    this.pendingEmployee = null;
    this.previewComparison = null;
    this.showMessage(`賞与修正を${UPDATE_MESSAGES.SUCCESS}`);
    await this.loadRows();
  }

  cancelPreview() {
    this.previewOpen = false;
    this.pendingPayroll = null;
    this.pendingOriginalPayroll = null;
    this.pendingEmployee = null;
    this.previewComparison = null;
  }

  displayBonusPayrollId(payrollId: string): string {
    return payrollId.replace('_bonus', '');
  }

  private getSnapshotTotals(snapshot: InsuranceSnapshot | null) {
    const payments = snapshot?.insurancePayments ?? [];
    const sum = (type: string) => {
      const payment = payments.find(item => item.insuranceType === type);
      return (payment?.employeeBurdenAmount ?? 0) + (payment?.companyBurdenAmount ?? 0);
    };
    return {
      health: sum('健康保険'),
      nursing: sum('介護保険'),
      pension: sum('厚生年金'),
    };
  }

  private showMessage(message: string) {
    this.messageTimer = this.commonService.showTimedMessage(
      message,
      value => this.message = value,
      this.messageTimer,
    );
  }

  private router = inject(Router);

  /** 賞与保険料差額一覧へ遷移 */
  toCorrectionBonusList() {
    this.router.navigate(['/correction-list'], { queryParams: { type: 'bonus' } });
  }
}
