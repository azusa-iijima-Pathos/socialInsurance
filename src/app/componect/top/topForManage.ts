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
import { SubmissionChecklist } from './submission-checklist/submission-checklist';


@Component({
  selector: 'app-topformanage',
  imports: [RouterLink, CommonModule, FormsModule, SubmissionChecklist],
  templateUrl: './topForManage.html',
  styleUrl: './topForManage.css',
})
export class TopForManage {

  private companyService = inject(CompanyService);
  private payrollLockService = inject(PayrollLockService);
  private insuranceSnapshotService = inject(InsuranceSnapshotService);

  loginUser = sessionStorage.getItem('loginEmployeeId');
  permission = sessionStorage.getItem('permission');

  companyId = sessionStorage.getItem('companyId');

  workingYear = sessionStorage.getItem('workingYear');

  //作業月
  workingMonth = sessionStorage.getItem('workingMonth');
  workingYearInput: string | null = null;
  workingMonthInput: string | null = null;

  //最新の賞与支給月のペイロールID
  latestLockedBonusPayrollId = '';
  lockedBonusPayrollIds: string[] = [];

  bonusMonths = computed<number[]>(() => this.companyService.company()?.settings?.bonusMonths ?? []);

  guardMessage = '';
  showExistingEmployeeLink = false;

  private route = inject(ActivatedRoute);
  private router = inject(Router);

  async ngOnInit() {
    this.guardMessage = consumeGuardMessage(this.route, this.router);
    await this.companyService.getCompany();
    if (this.workingMonth && !this.workingYear) {
      this.workingYear = new Date().getFullYear().toString();
      sessionStorage.setItem('workingYear', this.workingYear);
    }
    const lockedBonusPayrolls = await this.payrollLockService.getLockedPayrolls('賞与');
    this.lockedBonusPayrollIds = lockedBonusPayrolls.map(lock => lock.payrollId);
    this.latestLockedBonusPayrollId = lockedBonusPayrolls[0]?.payrollId ?? '';

    const hasSnapshot = await this.insuranceSnapshotService.hasAnyInsuranceSnapshotForCompany();
    this.showExistingEmployeeLink = !hasSnapshot;
  }

  setWorkingMonth() {
    if (!this.workingYearInput || !this.workingMonthInput) return;

    const workingYear = Number(this.workingYearInput);
    const workingMonth = Number(this.workingMonthInput);
    //作業月をセッションストレージに保存
    sessionStorage.setItem('workingMonth', workingMonth.toString());
    sessionStorage.setItem('workingYear', workingYear.toString());
    //会社情報を更新
    this.companyService.updateCompanySettings(this.companyId!, {
      workingMonth,
      workingYear,
    });
    this.workingYear = workingYear.toString();
    this.workingMonth = workingMonth.toString();
  }

  //賞与支給月の年を取得
  getBonusPaymentYear(month: number): number {
    const workingYear = Number(this.workingYear);
    const workingMonth = Number(this.workingMonth);
    // 1〜3月の作業月は常に当年
    if (workingMonth >= 1 && workingMonth <= 3) {
      return workingYear;
    }
    // 4〜12月の作業月
    if (month >= 4 && month <= 12) {
      return workingYear;
    }
    // 1〜3月のボーナス月
    return workingYear + 1;
  }


  //前月の年を取得
  getPreviousInsuranceOutputYear(): number {
    return Number(this.getPreviousWorkingYearMonth().split('-')[0]);
  }

  //前月の月を取得
  getPreviousInsuranceOutputMonth(): number {
    return Number(this.getPreviousWorkingYearMonth().split('-')[1]);
  }

  //前月の年月を取得
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

  //けんぽデータをFirestoreに保存
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

  //保険料率をFirestoreに保存
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

  //保険料率をFirestoreに保存
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

//等級マスタをFirestoreに保存
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
