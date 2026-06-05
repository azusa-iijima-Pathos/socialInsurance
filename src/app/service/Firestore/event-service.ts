import { inject, Injectable } from '@angular/core';
import { CrudService } from '../common/crud-service';
import { Event } from '../../model/event';
import { CompanyService } from './company-service';
import { EmployeeService } from './employee-service';
import { buildEventId, getWorkingYearMonth, isEventAtOrBeforeWorkingMonth } from '../logic/event-id-service';
import { EmployeeEventType } from '../../constants/model-constants';

export type EmployeeEventItem = Event & { employeeId: string };

/**
 * イベントサービス
 */
@Injectable({
  providedIn: 'root',
})
export class EventService {

  private crudService = inject(CrudService);
  private companyService = inject(CompanyService);
  private employeeService = inject(EmployeeService);

  private get path() {
    const companyId = sessionStorage.getItem('companyId');
    return `companies/${companyId}/employees`;
  }

  private get companyId(): string | null {
    return sessionStorage.getItem('companyId');
  }

  /** イベントIDを自動生成して作成 */
  async createEvent(employeeId: string, event: Partial<Event>): Promise<string | null> {
    if (!event.eventType) return null;

    await this.companyService.getCompany();
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
    const eventId = buildEventId(event.eventType as EmployeeEventType, {
      occurredDate: event.occurredDate?.toDate(),
      targetPeriodStart,
    });

    return this.createEventWithBaseId(employeeId, eventId, event);
  }

  /** ベースIDに連番を付けてイベントを作成（例: 雇用形態変更_04_1） */
  async createEventWithBaseId(employeeId: string, baseId: string, event: Partial<Event>): Promise<string | null> {
    const eventId = await this.allocateSequentialEventId(employeeId, baseId);
    return this.createEventWithId(employeeId, eventId, event);
  }

  /** 指定IDでイベントを作成 */
  async createEventWithId(employeeId: string, eventId: string, event: Partial<Event>): Promise<string | null> {
    event.companyId = this.companyId ?? '';
    event.eventId = eventId;
    const path = `${this.path}/${employeeId}/events/${eventId}`;

    if (await this.hasSameEvent(path)) {
      return null;
    }

    const created = await this.crudService.create(path, event);
    return created ? eventId : null;
  }

  /** 同一ベースIDの次の連番を返す */
  async allocateSequentialEventId(employeeId: string, baseId: string): Promise<string> {
    const events = await this.getEmployeeEvents(employeeId);
    const escapedBase = baseId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedBase}(?:_(\\d+))?$`);

    let maxSeq = 0;
    for (const event of events) {
      const match = event.eventId.match(pattern);
      if (match) {
        maxSeq = Math.max(maxSeq, match[1] ? Number(match[1]) : 0);
      }
    }

    return `${baseId}_${maxSeq + 1}`;
  }

  async getEmployeeEvents(employeeId: string): Promise<Event[]> {
    return await this.crudService.getAll<Event>(`${this.path}/${employeeId}/events`, 'eventId');
  }

  async getPendingEmployeeEvents(employeeId: string): Promise<Event[]> {
    const events = await this.getEmployeeEvents(employeeId);
    return events
      .filter(event => event.approval?.approvalStatus === '申請中')
      .sort((left, right) => right.eventId.localeCompare(left.eventId));
  }

  async getEmployeeEventsUpToWorkingMonth(employeeId: string): Promise<Event[]> {
    const events = await this.getEmployeeEvents(employeeId);
    const { year, month } = getWorkingYearMonth();
    if (!year || !month) return [];

    return events
      .filter(event => event.eventId && isEventAtOrBeforeWorkingMonth(event.eventId, year, month))
      .sort((left, right) => right.eventId.localeCompare(left.eventId));
  }

  /** 全社員の申請中イベント（作業月以前） */
  async getAllPendingEventsUpToWorkingMonth(): Promise<EmployeeEventItem[]> {
    await this.employeeService.getAllEmployees();
    const results: EmployeeEventItem[] = [];

    for (const employee of this.employeeService.allEmployees()) {
      const events = await this.getEmployeeEventsUpToWorkingMonth(employee.employeeId);
      for (const event of events) {
        if (event.approval?.approvalStatus !== '申請中') continue;
        results.push({ ...event, employeeId: employee.employeeId });
      }
    }

    return results.sort((left, right) => right.eventId.localeCompare(left.eventId));
  }

  async getReachAgeEvents(evnetId: string): Promise<Event[]> {
    return await this.crudService.getByCollectionGroupFields<Event>(
      'events',
      [
        { field: 'companyId', value: this.companyId! },
        { field: 'eventType', value: '一定年齢到達' },
        { field: 'eventId', value: evnetId },
      ],
      'eventId',
    );
  }

  async hasSameEvent(path: string): Promise<boolean> {
    const existingEvent = await this.crudService.getById<Event>(path, 'eventId');
    return existingEvent !== null;
  }

  async updateEvent(employeeId: string, eventId: string, event: Partial<Event>): Promise<boolean> {
    const path = `${this.path}/${employeeId}/events/${eventId}`;
    return await this.crudService.update(path, event);
  }

  /** 1社員の全てのイベントを取得 */
  async getEmployeeAllEvents(employeeId: string): Promise<Event[]> {
    const events = await this.crudService.getAll<Event>(`${this.path}/${employeeId}/events`, 'eventId');
    const eventFromMyself = events.filter(event => event.applicantType === '社員');
    return eventFromMyself.sort((left, right) => right.eventId.localeCompare(left.eventId));
  }
}
