import { inject, Injectable } from '@angular/core';
import { CompanyService } from '../Firestore/company-service';
import { Employee } from '../../model/employee';
import { EmployeeService } from '../Firestore/employee-service';
import { Event } from '../../model/event';
import { Timestamp } from '@angular/fire/firestore';
import { EventService } from '../Firestore/event-service';
import { ReachAgeType } from '../../constants/model-constants';
import { getDayBefore, getReachAgeInsuranceChangeDate, parseReachAgeFromType } from './event-id-service';


@Injectable({
  providedIn: 'root',
})
export class ReachAgeService {

  private companyService = inject(CompanyService);
  private employeeService = inject(EmployeeService);
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
      this.targetEndDate = new Date(this.workingYear, this.workingMonth, 0).getDate();
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

  private getPeriodBounds(): { periodStart: Date; periodEnd: Date } {
    const periodStart = new Date(
      this.targetStartYear,
      this.targetStartMonth - 1,
      this.targetStartDate,
      0,
      0,
      0,
      0,
    );
    const periodEnd = new Date(
      this.targetEndYear,
      this.targetEndMonth - 1,
      this.targetEndDate,
      23,
      59,
      59,
      999,
    );
    return { periodStart, periodEnd };
  }

  /** 年齢到達日（誕生日の1日前）が作業対象期間に含まれるか */
  private isAnniversaryInPeriod(
    anniversaryMonth: number,
    anniversaryDay: number,
    periodStart: Date,
    periodEnd: Date,
  ): boolean {
    const years = new Set([periodStart.getFullYear(), periodEnd.getFullYear()]);
    for (const year of years) {
      const candidate = new Date(year, anniversaryMonth, anniversaryDay, 12, 0, 0, 0);
      if (candidate >= periodStart && candidate <= periodEnd) {
        return true;
      }
    }
    return false;
  }

  private calculateAgeAtDate(birthDateOneDayBefore: Date, referenceDate: Date): number {
    let age = referenceDate.getFullYear() - birthDateOneDayBefore.getFullYear();
    const monthDiff = referenceDate.getMonth() - birthDateOneDayBefore.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < birthDateOneDayBefore.getDate())) {
      age -= 1;
    }
    return age;
  }

  private hasActiveReachAgeEvent(events: Event[], reachAgeType: ReachAgeType): boolean {
    return events.some(event =>
      event.eventType === '一定年齢到達'
      && event.reachAgeType === reachAgeType
      && event.approval?.approvalStatus !== '却下',
    );
  }

  //対象者を配列に格納
  private async searchTargetEmployees() {
    this.foutyYearOldEmployees = [];
    this.sixtyFiveYearOldEmployees = [];
    this.seventyYearOldEmployees = [];
    this.seventyFiveYearOldEmployees = [];

    await this.employeeService.getAllEmployees();
    const allEmployees: Employee[] = this.employeeService.allActiveEmployees();

    /** 対象期間を設定 */
    await this.setTargetPeriod();
    const { periodStart, periodEnd } = this.getPeriodBounds();

    for (const employee of allEmployees) {
      const birthDate = employee.birthDate?.toDate();
      if (!birthDate) continue;

      const birthDateOneDayBefore = getDayBefore(birthDate);

      if (!this.isAnniversaryInPeriod(
        birthDateOneDayBefore.getMonth(),
        birthDateOneDayBefore.getDate(),
        periodStart,
        periodEnd,
      )) {
        continue;
      }

      const age = this.calculateAgeAtDate(birthDateOneDayBefore, periodEnd);

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
    await this.searchTargetEmployees();

    const employeeEventsCache = new Map<string, Event[]>();
    let count = 0;

    const loadEvents = async (employeeId: string): Promise<Event[]> => {
      const cached = employeeEventsCache.get(employeeId);
      if (cached) return cached;
      const events = await this.eventService.getEmployeeEvents(employeeId);
      employeeEventsCache.set(employeeId, events);
      return events;
    };

    const createForEmployees = async (employees: Employee[], reachAgeType: ReachAgeType) => {
      for (const employee of employees) {
        const events = await loadEvents(employee.employeeId);
        if (this.hasActiveReachAgeEvent(events, reachAgeType)) {
          continue;
        }

        const birthDate = employee.birthDate!.toDate();
        const reachAge = parseReachAgeFromType(reachAgeType);
        if (reachAge === null) continue;
        const occurredDate = getReachAgeInsuranceChangeDate(birthDate, reachAge);
        const event: Partial<Event> = {
          occurredDate: Timestamp.fromDate(occurredDate),
          eventType: '一定年齢到達',
          reachAgeType,
          appliedDate: Timestamp.now(),
          applicantType: 'システム',
          approval: {
            approvalStatus: '申請中',
          },
          payload: {
            employee,
          },
        };
        const result = await this.eventService.createEvent(employee.employeeId, event);
        if (result) {
          count++;
          events.push({ ...event, eventId: result } as Event);
        }
      }
    };

    await createForEmployees(this.foutyYearOldEmployees, '40歳');
    await createForEmployees(this.sixtyFiveYearOldEmployees, '65歳');
    await createForEmployees(this.seventyYearOldEmployees, '70歳');
    await createForEmployees(this.seventyFiveYearOldEmployees, '75歳');

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




