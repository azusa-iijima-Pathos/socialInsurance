import { Component, inject } from '@angular/core';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { EventService } from '../../../service/Firestore/event-service';
import { ReachAgeService } from '../../../service/logic/reach-age';
import { CommonModule } from '@angular/common';
import { Event } from '../../../model/event';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { Timestamp } from '@angular/fire/firestore';
import { Employee } from '../../../model/employee';
import { getCurrentApprovedWorkingMonth } from '../../../service/logic/event-id-service';

@Component({
  selector: 'app-reach-age',
  imports: [CommonModule],
  templateUrl: './reach-age.html',
  styleUrl: './reach-age.css',
})
export class ReachAge {

  reachAgeService = inject(ReachAgeService);
  private eventService = inject(EventService);
  commonService = inject(CommonService);
  employeeService = inject(EmployeeService);
  createdEvents: Event[] = [];

  loginEmployeeId = sessionStorage.getItem('loginEmployeeId');

  /** 選択されたイベントID */
  selectedEvents = new Set<string>();

  message: string = '';
  private messageTimer: MessageTimer = null;

  async ngOnInit() {
    await this.getCreatedEvents();
    await this.employeeService.getAllEmployees();
  }

  async searchReachAge() {
    const count = await this.reachAgeService.createEvent();
    await this.getCreatedEvents();
    this.messageTimer = this.commonService.showTimedMessage(`${count}件検出しました。`, value => this.message = value, this.messageTimer);
  }

  //作成されたイベント一覧
  private async getCreatedEvents() {
    const dateForId = this.reachAgeService.workingYear! + '-' + this.reachAgeService.workingMonth!.toString().padStart(2, '0');
    const eventId = `一定年齢到達_${dateForId}`;
    console.log("eventId:", eventId);
    this.createdEvents = await this.eventService.getReachAgeEvents(eventId);
  }

  isPendingEvent(event: Event): boolean {
    return event.approval?.approvalStatus === '申請中';
  }

  getEventKey(event: Event): string {
    return event.payload?.['employee']?.employeeId ?? '';
  }

  /** イベントを選択 */
  onToggle(event: Event, checked: boolean) {
    if (!this.isPendingEvent(event)) return;
    const key = this.getEventKey(event);
    if (checked) {
      this.selectedEvents.add(key);
    } else {
      this.selectedEvents.delete(key);
    }
  }

  /** 申請中のイベントを全選択 */
  toggleAll() {
    this.createdEvents
      .filter(event => this.isPendingEvent(event))
      .forEach(event => this.selectedEvents.add(this.getEventKey(event)));
  }
  /** 全てのイベントを選択解除 */
  toggleAllClear() {
    this.selectedEvents.clear();
  }


  /** 選択されたイベントを承認 */
  async approveSelected() {
    await this.updateSelectedEvents('承認済み', true);
  }

  /** 選択されたイベントを却下 */
  async rejectSelected() {
    await this.updateSelectedEvents('却下', false);
  }

  private async updateSelectedEvents(status: '承認済み' | '却下', updateEmployee: boolean) {
    let count = 0;
    for (const employeeId of this.selectedEvents) {
      const event = this.createdEvents.find(item => this.getEventKey(item) === employeeId);
      if (!event || !this.isPendingEvent(event)) {
        continue;
      }

      event.approval = {
        approvalStatus: status,
        approvedDate: Timestamp.now(),
        approvedBy: this.loginEmployeeId!,
        approvedWorkingMonth: getCurrentApprovedWorkingMonth(),
      };
      const eventResult = await this.eventService.updateEvent(employeeId, event.eventId, event);
      if (!eventResult) {
        continue;
      }

      if (updateEmployee && status === '承認済み') {
        const occurredDate = event.occurredDate?.toDate();
        const employee: Employee | null = await this.employeeService.getEmployeeByEmployeeId(employeeId);
        if (!employee) {
          continue;
        }
        let updateEmployeeData: Partial<Employee> = {};
        switch (event.reachAgeType) {
          case '40歳':
            updateEmployeeData = {
              ...employee,
              insurance: {
                ...employee.insurance,
                nursingCareInsurance: {
                  joined: true,
                  acquiredDate: Timestamp.fromDate(occurredDate!),
                }
              },
            };
            break;
          case '65歳':
            updateEmployeeData = {
              ...employee,
              insurance: {
                ...employee.insurance,
                nursingCareInsurance: {
                  joined: false,
                  lostDate: Timestamp.fromDate(occurredDate!),
                }
              },
            };
            break;
          case '70歳':
            updateEmployeeData = {
              ...employee,
              insurance: {
                ...employee.insurance,
                employeePensionInsurance: {
                  joined: false,
                  lostDate: Timestamp.fromDate(occurredDate!),
                }
              },
            };
            break;
          case '75歳':
            updateEmployeeData = {
              ...employee,
              insurance: {
                ...employee.insurance,
                healthInsurance: {
                  joined: false,
                  lostDate: Timestamp.fromDate(occurredDate!),
                }
              },
            };
            break;
        }

        const employeeResult = await this.employeeService.updateEmployee(updateEmployeeData);
        if (!employeeResult) {
          continue;
        }
      }

      count++;
    }

    if (count > 0) {
      this.messageTimer = this.commonService.showTimedMessage(
        `${count}件のイベントを${status === '承認済み' ? '承認' : '却下'}しました`,
        value => this.message = value,
        this.messageTimer,
      );
      this.selectedEvents.clear();
      await this.getCreatedEvents();
    }
  }
}