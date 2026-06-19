import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Event as EmployeeEvent } from '../../model/event';
import { CrudService } from '../common/crud-service';
import { getCurrentApprovedWorkingMonth } from '../logic/event-id-service';

@Injectable({
  providedIn: 'root',
})
export class EmployeeEventService {

  private crudService = inject(CrudService);

  private get path() {
    const companyId = sessionStorage.getItem('companyId');
    return `companies/${companyId}/employees`;
  }

  async createHireEvent(employeeId: string, payload: Record<string, unknown>): Promise<boolean> {
    const eventId = `hire_${employeeId}_${Date.now()}`;
    const loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? '';

    return await this.crudService.create<EmployeeEvent>(
      `${this.path}/${employeeId}/events/${eventId}`,
      {
        eventId,
        occurredDate: payload['hireDate'] as Timestamp,
        eventType: '入社',
        appliedDate: Timestamp.now(),
        applicantType: '管理者',
        approval: {
          approvalStatus: '承認済み',
          approvedDate: Timestamp.now(),
          approvedBy: loginEmployeeId,
          approvedWorkingMonth: getCurrentApprovedWorkingMonth(),
        },
        payload,
      },
    );
  }

}
