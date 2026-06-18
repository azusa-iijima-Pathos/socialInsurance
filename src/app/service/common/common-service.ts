import { inject, Injectable, signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { OfficeService } from '../Firestore/office-service';
import { EmployeeService } from '../Firestore/employee-service';
import { CompanyService } from '../Firestore/company-service';
import { Company } from '../../model/company';

export type MessageTimer = ReturnType<typeof setTimeout> | null;

@Injectable({
  providedIn: 'root',
})
export class CommonService {

  private officeService = inject(OfficeService);
  private employeeService = inject(EmployeeService);

  //日付表示
  //日付をYYYY/MM/DD HH:MM:SS形式で表示
  formatDateTime(date: Timestamp | null | undefined): string {
    if (!date) return '';
    return date.toDate().toLocaleString();
  }
  //日付をYYYY/MM/DD形式で表示
  formatDate(date: Timestamp | null | undefined): string {
    if (!date) return '未定';
    return date.toDate().toLocaleDateString();
  }

  //年齢を計算
  calculateAge(date: Timestamp | null | undefined): number {
    if (!date) return 0;
    const today = new Date();
    const birthDate = date.toDate();
    const age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      return age - 1;
    }
    return age;
  }

  /** 全マップを取得 */
  async getAllMaps() {
    //事業所
    await this.officeService.getAllOffice();
    //社員
    await this.employeeService.getAllEmployees();

  }

  //IDから事業所名を取得
  getOfficeName(officeId: string): string | null {
    if (!officeId || officeId === '') {
      return '未定';
    }
    const officeNameMap = this.officeService.allOfficeNameMap();
    return officeNameMap[officeId] ?? null;
  }

  //IDから社員名を取得
  getEmployeeName(employeeId: string): string | null {
    if (!employeeId || employeeId === '') {
      return '未定';
    }
    const employeeNameMap = this.employeeService.allEmployeeNameMap();
    return employeeNameMap[employeeId] ?? null;
  }

  /** メッセージを表示し、指定時間後に空へ戻す */
  showTimedMessage(
    message: string,
    setMessage: (message: string) => void,
    currentTimer: MessageTimer,
    displayTimeMs: number = 10000
  ): MessageTimer {
    if (!message) {
      return this.clearTimedMessage(setMessage, currentTimer);
    }
    setMessage(message);
    if (currentTimer) {
      clearTimeout(currentTimer);
    }
    return setTimeout(() => {
      setMessage('');
    }, displayTimeMs);
  }

  /** 表示中メッセージとタイマーを明示的に消す */
  clearTimedMessage(setMessage: (message: string) => void, currentTimer: MessageTimer): MessageTimer {
    setMessage('');
    if (currentTimer) {
      clearTimeout(currentTimer);
    }
    return null;
  }



  companyService = inject(CompanyService);
  targetPeriod = signal<string>('');
  targetPeriodStartDay = signal<string>('');
  private isTargetPeriodLoaded = false;
  private loadedCompanyId = '';
  private cachedWorkingYear: number | null = null;
  private cachedWorkingMonth: number | null = null;
  private loadTargetPeriodPromise: Promise<void> | null = null;

  resetTargetPeriodCache(): void {
    this.isTargetPeriodLoaded = false;
    this.loadedCompanyId = '';
    this.cachedWorkingYear = null;
    this.cachedWorkingMonth = null;
    this.targetPeriod.set('');
    this.targetPeriodStartDay.set('');
  }

  async refreshTargetPeriod(): Promise<void> {
    this.resetTargetPeriodCache();
    return this.getCurrentTargetPeriod();
  }

  //今の対象期間を取得（〇月〇日～〇月〇日）
  async getCurrentTargetPeriod(): Promise<void> {
    const companyId = sessionStorage.getItem('companyId') ?? '';
    if (!companyId) {
      this.resetTargetPeriodCache();
      return;
    }

    const sessionYear = Number(sessionStorage.getItem('workingYear'));
    const sessionMonth = Number(sessionStorage.getItem('workingMonth'));
    const workingPeriodChanged =
      this.cachedWorkingYear !== sessionYear
      || this.cachedWorkingMonth !== sessionMonth;
    if (workingPeriodChanged) {
      this.isTargetPeriodLoaded = false;
    }

    if (this.isTargetPeriodLoaded && this.loadedCompanyId === companyId) {
      return;
    }
    if (this.loadTargetPeriodPromise) {
      return this.loadTargetPeriodPromise;
    }

    this.loadTargetPeriodPromise = this.loadTargetPeriod(companyId).finally(() => {
      this.loadTargetPeriodPromise = null;
    });
    return this.loadTargetPeriodPromise;
  }

  private async loadTargetPeriod(companyId: string): Promise<void> {
    await this.companyService.getCompany();
    const company = this.companyService.company();
    const settings = company?.settings;
    const workingYear = settings?.workingYear ?? Number(sessionStorage.getItem('workingYear'));
    const workingMonth = settings?.workingMonth ?? Number(sessionStorage.getItem('workingMonth'));
    const targetPeriod = settings?.targetPeriod ?? [1, 31];

    if (!workingYear || !workingMonth) {
      this.targetPeriod.set('');
      this.targetPeriodStartDay.set('');
      return;
    }

    const targetPeriodStart = targetPeriod[0] ?? 1;
    let targetPeriodEnd: number | string = targetPeriod[1] ?? 31;
    if (targetPeriodEnd === 31) {
      targetPeriodEnd = '末日';
    } else {
      targetPeriodEnd = `${String(targetPeriodEnd).padStart(2, '0')}日`;
    }
    this.targetPeriod.set(`${workingYear}年${String(workingMonth).padStart(2, '0')}月${String(targetPeriodStart).padStart(2, '0')}日～${targetPeriodEnd}`);
    this.targetPeriodStartDay.set(`${workingYear}年${String(workingMonth).padStart(2, '0')}月${String(targetPeriodStart).padStart(2, '0')}日`);
    this.isTargetPeriodLoaded = true;
    this.loadedCompanyId = companyId;
    this.cachedWorkingYear = workingYear;
    this.cachedWorkingMonth = workingMonth;
  }

}
