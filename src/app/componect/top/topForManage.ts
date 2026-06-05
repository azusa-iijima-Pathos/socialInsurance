import { Component, inject, computed } from '@angular/core';
import {  RouterLink } from '@angular/router';
import { CompanyService } from '../../service/Firestore/company-service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PayrollLockService } from '../../service/Firestore/payroll-lock-service';


@Component({
  selector: 'app-topformanage',
  imports: [RouterLink, CommonModule, FormsModule],
  templateUrl: './topForManage.html',
  styleUrl: './topForManage.css',
})
export class TopForManage {

  private companyService = inject(CompanyService);
  private payrollLockService = inject(PayrollLockService);

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

  async ngOnInit() {
    this.companyService.getCompany();
    if (this.workingMonth && !this.workingYear) {
      this.workingYear = new Date().getFullYear().toString();
      sessionStorage.setItem('workingYear', this.workingYear);
    }
    const lockedBonusPayrolls = await this.payrollLockService.getLockedPayrolls('賞与');
    this.lockedBonusPayrollIds = lockedBonusPayrolls.map(lock => lock.payrollId);
    this.latestLockedBonusPayrollId = lockedBonusPayrolls[0]?.payrollId ?? '';
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
    return month >= workingMonth ? workingYear : workingYear + 1;
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

} 
