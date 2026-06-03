import { computed, inject, Injectable } from '@angular/core';
import { CompanyService } from '../Firestore/company-service';
import { Employee } from '../../model/employee';
import { EmployeeService } from '../Firestore/employee-service';
import { CommonService } from '../common/common-service';
import { Event } from '../../model/event';
import { Timestamp } from '@angular/fire/firestore';
import { EventService } from '../Firestore/event-service';


@Injectable({
  providedIn: 'root',
})
export class ReachAgeService {

  private companyService = inject(CompanyService);
  private employeeService = inject(EmployeeService);
  private commonService = inject(CommonService);
  private eventService = inject(EventService);

  foutyYearOldEmployees: Employee[] = [];
  sixtyFiveYearOldEmployees: Employee[] = [];
  seventyYearOldEmployees: Employee[] = [];
  seventyFiveYearOldEmployees: Employee[] = [];

  /** 作業月 */
  get workingMonth() {
    return Number(sessionStorage.getItem('workingMonth')!);
  }

  get workingYear() {
    return Number(sessionStorage.getItem('workingYear')!);
  }

  /** 対象月期間　*/
  targetStartYear: number = 0;
  targetStartMonth: number = 0;
  targetStartDate: number = 0;
  targetEndYear: number = 0;
  targetEndMonth: number = 0;
  targetEndDate: number = 0;

  /** 対象期間を設定 */
  private async setTargetPeriod() {
    await this.companyService.getCompany();
    const companySettings = this.companyService.company()?.settings;
    const targetPeriodStart = companySettings?.targetPeriod[0];
    const targetPeriodEnd = companySettings?.targetPeriod[1];

    if (targetPeriodStart === 1) {
      this.targetStartMonth = this.workingMonth;
      this.targetStartDate = 1;
      this.targetEndMonth = this.workingMonth;
      this.targetEndDate = 31;
      this.targetStartYear = this.workingYear;
      this.targetEndYear = this.workingYear;
    } else {
      if (this.workingMonth === 12) {
        this.targetStartYear = this.workingYear;
        this.targetEndYear = this.workingYear + 1;

        this.targetStartMonth = this.workingMonth;
        this.targetStartDate = targetPeriodStart!;
        this.targetEndMonth = 1;
        this.targetEndDate = targetPeriodEnd!;
      } else {
        this.targetStartYear = this.workingYear;
        this.targetEndYear = this.workingYear;
        this.targetStartMonth = this.workingMonth;
        this.targetStartDate = targetPeriodStart!;
        this.targetEndMonth = this.workingMonth + 1;
        this.targetEndDate = targetPeriodEnd!;
      }
    }
  }

  //対象者を配列に格納
  private async searchTargetEmployees() {
    await this.employeeService.getAllEmployees();
    const allEmployees: Employee[] = this.employeeService.allActiveEmployees();

    /** 対象期間を設定 */
    await this.setTargetPeriod();

    console.log(this.targetStartYear, this.targetStartMonth, this.targetStartDate);
    console.log(this.targetEndYear, this.targetEndMonth, this.targetEndDate);

    for (const employee of allEmployees) {

      //誕生日を取得（１日前の日付）
      const birthDate = employee.birthDate?.toDate();
      if (!birthDate) continue;

      // コピーして1日前を作る（元データ壊さない）
      const birthDateOneDayBefore = new Date(birthDate);
      birthDateOneDayBefore.setDate(birthDateOneDayBefore.getDate() - 1);
      const birthDateOneDayBeforeForCompare = new Date(
        birthDate.getMonth(),
        birthDate.getDate()
      );

      // 対象期間の開始・終了
      const start = new Date(this.targetStartMonth - 1, this.targetStartDate, 0, 0, 0);
      const endWithoutYear = new Date(this.targetEndMonth - 1, this.targetEndDate, 23, 59, 59);

      const end = new Date(this.targetEndYear, this.targetEndMonth - 1, this.targetEndDate, 23, 59, 59);

      //この誕生日が対象期間に入っているか確認
      const isInTargetPeriod: boolean = birthDateOneDayBeforeForCompare >= start && birthDateOneDayBeforeForCompare <= endWithoutYear;
      if (!isInTargetPeriod) continue;

      //該当期間に何歳になるか確認
      let age = end.getFullYear() - birthDateOneDayBefore.getFullYear();
      const monthDiff = end.getMonth() - birthDateOneDayBefore.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && end.getDate() < birthDateOneDayBefore.getDate())) {
        age -= 1;
      }

      console.log(`${employee.employeeId}：${age}歳`);

      //該当の年齢に到達したタイミングの場合、対象者を配列に格納
      if (age === 40) {
        this.foutyYearOldEmployees.push(employee);
      } else if (age === 65) {
        this.sixtyFiveYearOldEmployees.push(employee);
      } else if (age === 70) {
        this.seventyYearOldEmployees.push(employee);
      } else if (age === 75) {
        this.seventyFiveYearOldEmployees.push(employee);
      }

    }
  }

  /** イベントを作成 */
  async createEvent() {

    /** 対象者の配列を作成 */
    await this.searchTargetEmployees();

    const now = new Date();
    let count = 0;
    for (const employee of this.foutyYearOldEmployees) {
      const birthDate = employee.birthDate!.toDate();
      const occurredDate = new Date(now.getFullYear(), birthDate.getMonth(), birthDate.getDate(), 0, 0, 0);
      const event: Partial<Event> = {
        occurredDate: Timestamp.fromDate(occurredDate),
        eventType: '一定年齢到達',
        reachAgeType: '40歳',
        appliedDate: Timestamp.now(),
        applicantType: 'システム',
        approval: {
          approvalStatus: '申請中',
        },
        payload: {
          employee: employee,
        }
      };
      const result = await this.eventService.createEvent(employee.employeeId, event);
      if (result) {
        count++;
      } else {
        console.log(`${employee.employeeId}のイベント作成に失敗しました`);
      }
    }

    for (const employee of this.sixtyFiveYearOldEmployees) {
      const birthDate = employee.birthDate!.toDate();
      const occurredDate = new Date(now.getFullYear(), birthDate.getMonth(), birthDate.getDate(), 0, 0, 0);

      const event: Partial<Event> = {
        occurredDate: Timestamp.fromDate(occurredDate),
        eventType: '一定年齢到達',
        reachAgeType: '65歳',
        appliedDate: Timestamp.now(),
        applicantType: 'システム',
        approval: {
          approvalStatus: '申請中',
        },
        payload: {
          employee: employee,
        }
      };
      const result = await this.eventService.createEvent(employee.employeeId, event);
      if (result) {
        count++;
      } else {
        console.log(`${employee.employeeId}のイベント作成に失敗しました`);
      }
    }
    for (const employee of this.seventyYearOldEmployees) {
      const birthDate = employee.birthDate!.toDate();
      const occurredDate = new Date(now.getFullYear(), birthDate.getMonth(), birthDate.getDate(), 0, 0, 0);
      const event: Partial<Event> = {
        occurredDate: Timestamp.fromDate(occurredDate),
        eventType: '一定年齢到達',
        reachAgeType: '70歳',
        appliedDate: Timestamp.now(),
        applicantType: 'システム',
        approval: {
          approvalStatus: '申請中',
        },
        payload: {
          employee: employee,
        }
      };
      const result = await this.eventService.createEvent(employee.employeeId, event);
      if (result) {
        count++;
      } else {
        console.log(`${employee.employeeId}のイベント作成に失敗しました`);
      }
    }

    for (const employee of this.seventyFiveYearOldEmployees) {
      const birthDate = employee.birthDate!.toDate();
      const occurredDate = new Date(now.getFullYear(), birthDate.getMonth(), birthDate.getDate(), 0, 0, 0);
      const event: Partial<Event> = {
        occurredDate: Timestamp.fromDate(occurredDate),
        eventType: '一定年齢到達',
        reachAgeType: '75歳',
        appliedDate: Timestamp.now(),
        applicantType: 'システム',
        approval: {
          approvalStatus: '申請中',
        },
        payload: {
          employee: employee,
        }
      };
      const result = await this.eventService.createEvent(employee.employeeId, event);
      if (result) {
        count++;
      } else {
        console.log(`${employee.employeeId}のイベント作成に失敗しました`);
      }
    }

    return count;
  }
}










/**
 * 5月２日誕生日の場合
 * 
 * １から月末当月
 * 今が５月です→支払い月は５月
 * 保険適用は５月の給与（支払い月５月）から
 * 
 * １５日～１４日で当月締め
 * 今が５月です→支払い月は６月
 * 保険適用は４月の給与（支払い月５月）から
 * 
 * １から月末翌月
 * 今が５月→支払い月は６月
 * 保険適用は５月の給与（支払い月６月）から
 * 
 * １５日～１４日翌月
 * 今が５月→支払い月は７月
 * 保険適用は５月の給与（支払い月７月）から
 * 
 */




