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
  isTargetPeriodLoaded = false;
  //今の対象期間を取得（〇月〇日～〇月〇日）
  async getCurrentTargetPeriod() {
    if (this.isTargetPeriodLoaded) {
      return;
    }
    //会社情報を取得
    await this.companyService.getCompany();
    const company = this.companyService.company();
    if (!company) {
      throw new Error('会社情報が取得できません');
    }
    if (!company.settings) {
      throw new Error('会社情報が取得できません');
    }
    const targetPeriod = company.settings.targetPeriod;
    const targetPeriodStart = targetPeriod[0];
    let targetPeriodEnd: number | string = targetPeriod[1];
    if (targetPeriodEnd === 31) {
      targetPeriodEnd = '末日';
    }else{
      targetPeriodEnd = `${String(targetPeriodEnd).padStart(2, '0')}日`;
    }
    const workingMonth = company.settings.workingMonth;
    const workingYear = company.settings.workingYear;
    this.targetPeriod.set(`${workingYear}年${String(workingMonth).padStart(2, '0')}月${String(targetPeriodStart).padStart(2, '0')}日～${targetPeriodEnd}`);
    this.targetPeriodStartDay.set(`${workingYear}年${String(workingMonth).padStart(2, '0')}月${String(targetPeriodStart).padStart(2, '0')}日`);
    this.isTargetPeriodLoaded = true;
  }

}
