import { Component, inject, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CompanyService } from '../../service/Firestore/company-service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PayrollLockService } from '../../service/Firestore/payroll-lock-service';
import { InsuranceSnapshotService } from '../../service/Firestore/insurance-snapshot-service';
import { STANDARD_MONTHLY_REMUNERATION_2026, STANDARD_MONTHLY_REMUNERATION_2025, STANDARD_MONTHLY_REMUNERATION_2024, STANDARD_MONTHLY_REMUNERATION_2023 } from '../../insuranceData/forEmployee';
import { STANDARD_MONTHLY_REMUNERATION_PERIOD_2026, STANDARD_MONTHLY_REMUNERATION_PERIOD_2025, STANDARD_MONTHLY_REMUNERATION_PERIOD_2024, STANDARD_MONTHLY_REMUNERATION_PERIOD_2023 } from '../../insuranceData/forEmployee';
import { PREFECTURE_INSURANCE_RATES_2026, PREFECTURE_INSURANCE_RATES_2025, PREFECTURE_INSURANCE_RATES_2024, PREFECTURE_INSURANCE_RATES_2023 } from '../../insuranceData/forEmployee';
import { INSURANCE_RATE_PERIOD_2026, INSURANCE_RATE_PERIOD_2025, INSURANCE_RATE_PERIOD_2024, INSURANCE_RATE_PERIOD_2023 } from '../../insuranceData/forEmployee';
import { Firestore, doc, writeBatch } from '@angular/fire/firestore';
import { consumeGuardMessage } from '../../service/common/guard-message.util';
import { EmployeeService } from '../../service/Firestore/employee-service';
import { PayrollService } from '../../service/Firestore/payroll-service';
import { EventService } from '../../service/Firestore/event-service';
import { CalculationRunService } from '../../service/Firestore/calculation-run-service';
import { AnnouncementService } from '../../service/Firestore/announcement-service';
import { ReachAgeService } from '../../service/logic/reach-age';
import { CommonService } from '../../service/common/common-service';


@Component({
  selector: 'app-topformanage',
  imports: [RouterLink, CommonModule, FormsModule],
  templateUrl: './topForManage.html',
  styleUrl: './topForManage.css',
})
export class TopForManage {

  private companyService = inject(CompanyService);
  private payrollLockService = inject(PayrollLockService);
  private insuranceSnapshotService = inject(InsuranceSnapshotService);
  private employeeService = inject(EmployeeService);
  private payrollService = inject(PayrollService);
  private eventService = inject(EventService);
  private calculationRunService = inject(CalculationRunService);
  private announcementService = inject(AnnouncementService);
  private reachAgeService = inject(ReachAgeService);
  private commonService = inject(CommonService);

  loginUser = sessionStorage.getItem('loginEmployeeId');
  permission = sessionStorage.getItem('permission');

  companyId = sessionStorage.getItem('companyId');

  workingYear = sessionStorage.getItem('workingYear');

  workingMonth = sessionStorage.getItem('workingMonth');
  workingYearInput: string | null = null;
  workingMonthInput: string | null = null;

  latestLockedBonusPayrollId = '';
  lockedBonusPayrollIds: string[] = [];
  hasBonusPayrollLock = false;

  bonusMonths = computed<number[]>(() => this.companyService.company()?.settings?.bonusMonths ?? []);

  guardMessage = '';
  showExistingEmployeeLink = false;

  salaryTaskComplete = false;
  applicationTaskComplete = false;
  insuranceTaskComplete = false;
  checklistTaskComplete = false;
  calculationBaseTaskComplete = false;
  canAdvanceWorkingMonth = false;
  nextWorkingMonthLabel = '';

  private route = inject(ActivatedRoute);
  private router = inject(Router);

  async ngOnInit() {
    this.guardMessage = consumeGuardMessage(this.route, this.router);
    await this.companyService.getCompany();
    if (this.workingMonth && !this.workingYear) {
      this.workingYear = new Date().getFullYear().toString();
      sessionStorage.setItem('workingYear', this.workingYear);
    }
    const bonusPayrollLocks = await this.payrollLockService.getPayrollLocks('賞与');
    this.hasBonusPayrollLock = bonusPayrollLocks.length > 0;
    const lockedBonusPayrolls = bonusPayrollLocks.filter(lock => lock.locked);
    this.lockedBonusPayrollIds = lockedBonusPayrolls.map(lock => lock.payrollId);
    this.latestLockedBonusPayrollId = lockedBonusPayrolls[0]?.payrollId ?? '';

    const hasSnapshot = await this.insuranceSnapshotService.hasAnyInsuranceSnapshotForCompany();
    this.showExistingEmployeeLink = !hasSnapshot;

    await this.loadMonthlyTaskStatus();
  }

  private async loadMonthlyTaskStatus() {
    if (!this.workingYear || !this.workingMonth) return;

    const year = Number(this.workingYear);
    const month = Number(this.workingMonth);
    const payrollId = `${year}-${String(month).padStart(2, '0')}`;

    await this.employeeService.getAllEmployees();
    await this.payrollService.getAllPayrollListForMonth(payrollId, true);
    const registeredIds = new Set(
      this.payrollService.allPayrollListForMonth()
        .find(item => item.payrollId === payrollId)?.payrollList
        .map(payroll => payroll.employeeId ?? '') ?? [],
    );
    const eligibleEmployees = this.employeeService.employeesEligibleForPayrollPeriod(payrollId);
    this.salaryTaskComplete = eligibleEmployees.length > 0
      && eligibleEmployees.every(employee => registeredIds.has(employee.employeeId));

    const [pendingEvents, pendingRuns, pendingEmployeeApps, approvedEmployeeApps, applicableAdHocRevisions] = await Promise.all([
      this.eventService.getAllPendingEventsUpToWorkingMonth(),
      this.calculationRunService.getPendingSystemRunsUpToWorkingMonth(),
      this.eventService.getAllPendingEmployeeApplicationEvents(),
      this.eventService.getApprovedEmployeeApplicationEventsForCurrentWorkMonth(),
      this.calculationRunService.getApplicableApprovedAdHocRevisionRuns(),
    ]);
    const hasPendingApplications = pendingEvents.length > 0
      || pendingRuns.length > 0
      || pendingEmployeeApps.length > 0;
    const hasPendingApplies = applicableAdHocRevisions.length > 0 || approvedEmployeeApps.length > 0;
    this.applicationTaskComplete = !hasPendingApplications && !hasPendingApplies;

    this.insuranceTaskComplete = await this.payrollLockService.isPayrollLocked(payrollId);
    this.canAdvanceWorkingMonth = this.insuranceTaskComplete;

    const announcements = await this.announcementService.getAllAnnouncements();
    this.checklistTaskComplete = announcements.every(item => item.checked);

    await this.loadCalculationBaseTaskStatus(year, month);

    this.nextWorkingMonthLabel = this.getNextWorkingMonthLabel(year, month);
  }

  private async loadCalculationBaseTaskStatus(year: number, month: number) {
    this.calculationBaseTaskComplete = false;
    if (month !== 7 && month !== 9) return;

    const calculationBaseRun = await this.calculationRunService.getCalculationBaseRun(year);
    if (month === 7) {
      this.calculationBaseTaskComplete = calculationBaseRun?.approval?.approvalStatus === '承認済み';
      return;
    }
    this.calculationBaseTaskComplete = String(calculationBaseRun?.payload?.['status'] ?? '') === '反映済み';
  }

  private getNextWorkingMonthLabel(year: number, month: number): string {
    let nextMonth = month + 1;
    let nextYear = year;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    return `${nextMonth}月`;
  }

  async advanceToNextWorkingMonth() {
    if (!this.canAdvanceWorkingMonth || !this.companyId || !this.workingYear || !this.workingMonth) return;
    if (!window.confirm(`${this.workingMonth}月分保険料と同時に請求を行いたい差額調整の入力がある場合、先に遡及修正を行ってください。\n完了している場合、${this.nextWorkingMonthLabel}の作業へ移動します。`)) return;

    let newWorkingMonth = Number(this.workingMonth) + 1;
    let newWorkingYear = Number(this.workingYear);
    if (newWorkingMonth > 12) {
      newWorkingMonth = 1;
      newWorkingYear += 1;
    }

    const result = await this.companyService.updateCompanySettings(this.companyId, {
      workingMonth: newWorkingMonth,
      workingYear: newWorkingYear,
    });
    if (!result) {
      window.alert('作業月の更新に失敗しました');
      return;
    }

    sessionStorage.setItem('workingMonth', newWorkingMonth.toString());
    sessionStorage.setItem('workingYear', newWorkingYear.toString());
    this.workingMonth = newWorkingMonth.toString();
    this.workingYear = newWorkingYear.toString();
    await this.reachAgeService.createEvent();
    await this.commonService.refreshTargetPeriod();
    await this.loadMonthlyTaskStatus();
  }

  setWorkingMonth() {
    if (!this.workingYearInput || !this.workingMonthInput) return;

    const workingYear = Number(this.workingYearInput);
    const workingMonth = Number(this.workingMonthInput);
    sessionStorage.setItem('workingMonth', workingMonth.toString());
    sessionStorage.setItem('workingYear', workingYear.toString());
    this.companyService.updateCompanySettings(this.companyId!, {
      workingMonth,
      workingYear,
    });
    this.workingYear = workingYear.toString();
    this.workingMonth = workingMonth.toString();
  }

  getBonusPaymentYear(month: number): number {
    const workingYear = Number(this.workingYear);
    const workingMonth = Number(this.workingMonth);
    if (workingMonth >= 1 && workingMonth <= 3) {
      return workingYear;
    }
    if (month >= 4 && month <= 12) {
      return workingYear;
    }
    return workingYear + 1;
  }

  getPreviousInsuranceOutputYear(): number {
    return Number(this.getPreviousWorkingYearMonth().split('-')[0]);
  }

  getPreviousInsuranceOutputMonth(): number {
    return Number(this.getPreviousWorkingYearMonth().split('-')[1]);
  }

  getPreviousWorkingYearMonth(): string {
    if (!this.workingYear || !this.workingMonth) return '';

    let year = Number(this.workingYear);
    let month = Number(this.workingMonth) - 1;
    if (month < 1) {
      month = 12;
      year--;
    }
    return `${year}-${String(month).padStart(2, '0')}`;
  }


  private firestore = inject(Firestore);

  toCompanySetting() {
    this.router.navigate(['/company-setting'], { queryParams: { mode: 'initial' } });
  }

  async seedGrades() {
    console.log('seedGrades');
    await this.seedGradesForYear('2026', STANDARD_MONTHLY_REMUNERATION_2026, STANDARD_MONTHLY_REMUNERATION_PERIOD_2026);
  }

  async seedGrades2025() {
    console.log('seedGrades2025');
    await this.seedGradesForYear('2025', STANDARD_MONTHLY_REMUNERATION_2025, STANDARD_MONTHLY_REMUNERATION_PERIOD_2025);
  }

  async seedGrades2023() {
    console.log('seedGrades2023');
    await this.seedGradesForYear('2023', STANDARD_MONTHLY_REMUNERATION_2023, STANDARD_MONTHLY_REMUNERATION_PERIOD_2023);
  }

  async seedInsuranceRates() {
    await this.seedInsuranceRatesForYear('2026', PREFECTURE_INSURANCE_RATES_2026, INSURANCE_RATE_PERIOD_2026);
  }

  async seedInsuranceRates2025() {
    await this.seedInsuranceRatesForYear('2025', PREFECTURE_INSURANCE_RATES_2025, INSURANCE_RATE_PERIOD_2025);
  }

  async seedInsuranceRates2023() {
    console.log('seedInsuranceRates2023');
    await this.seedInsuranceRatesForYear('2023', PREFECTURE_INSURANCE_RATES_2023, INSURANCE_RATE_PERIOD_2023);
  }

  private async seedInsuranceRatesForYear(
    year: string,
    rates: { id: string;[key: string]: string | number }[],
    period: { effectiveFrom: string; effectiveTo: string },
  ) {
    const batch = writeBatch(this.firestore);
    batch.set(doc(this.firestore, 'insuranceRates', year), period, { merge: true });

    for (const item of rates) {
      const ref = doc(
        this.firestore,
        'insuranceRates',
        year,
        'prefectures',
        `${item.id}`
      );

      batch.set(ref, item);
    }

    await batch.commit();
  }

  private async seedGradesForYear(
    year: string,
    grades: { grade: number;[key: string]: string | number }[],
    period: { effectiveFrom: string; effectiveTo: string },
  ) {
    const batch = writeBatch(this.firestore);
    batch.set(doc(this.firestore, 'standardMonthlyRemunerations', year), period, { merge: true });

    for (const item of grades) {
      const ref = doc(
        this.firestore,
        'standardMonthlyRemunerations',
        year,
        'grades',
        `${item.grade}`
      );

      batch.set(ref, item);
    }

    await batch.commit();
  }

}
