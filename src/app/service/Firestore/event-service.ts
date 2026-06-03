import { inject, Injectable } from '@angular/core';
import { CrudService } from '../common/crud-service';
import { Event } from '../../model/event';
import { Timestamp } from '@angular/fire/firestore';

/**
 * イベントサービス
 */
//PATH: companies/{companyId}/employees/{employeeId}/events/{eventId}

@Injectable({
  providedIn: 'root',
})
export class EventService {

  private crudService = inject(CrudService);

  private get path() {
    const companyId = sessionStorage.getItem('companyId');
    return `companies/${companyId}/employees`;
  }

  private get companyId(): string | null {
    return sessionStorage.getItem('companyId');
  }

  private get workingYear(): number | null {
    return Number(sessionStorage.getItem('workingYear'));
  }

  private get workingMonth(): number | null {
    return Number(sessionStorage.getItem('workingMonth'));
  }

  // イベントを作成（入社/退社/一定年齢到達）
  async createEvent(employeeId: string, event: Partial<Event>): Promise<boolean> {
   
    const type = event.eventType ?? '';
    const date = this.workingYear! + '-' + this.workingMonth!.toString().padStart(2, '0');
    event.companyId = this.companyId ?? '';
    const eventId = `${type}_${date}`;
    event.eventId = eventId;
    const path = `${this.path}/${employeeId}/events/${eventId}`;

    //同じIDのイベントが存在するか確認
    const hasSameEvent = await this.hasSameEvent(path);
    if (hasSameEvent) {
      return false;
    }
    return await this.crudService.create(path, event);
  }

  // 年齢到達イベント一覧を取得
  async getReachAgeEvents(evnetId: string): Promise<Event[]> {
    const events: Event[] = await this.crudService.getByCollectionGroupFields<Event>(
      'events',
      [
        { field: 'companyId', value: this.companyId! },
        { field: 'eventType', value: '一定年齢到達' },
        { field: 'eventId', value: evnetId },
      ],
      'eventId'
    );
    return events;
  }

  // 同じIDのイベントが存在するか確認
  async hasSameEvent(path: string): Promise<boolean> {
    const existingEvent = await this.crudService.getById<Event>(path,'eventId');
    return existingEvent === null ? false : true;
  }

  // イベントを更新
  async updateEvent(employeeId: string, eventId: string, event: Partial<Event>): Promise<boolean> {
    const path = `${this.path}/${employeeId}/events/${eventId}`;
    return await this.crudService.update(path, event);
  }
}
