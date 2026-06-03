import { Component, inject } from '@angular/core';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { EventService } from '../../../service/Firestore/event-service';
import { ReachAgeService } from '../../../service/logic/reach-age';
import { CommonModule } from '@angular/common';
import { Event } from '../../../model/event';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { Timestamp } from '@angular/fire/firestore';
import { Employee } from '../../../model/employee';

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

  /** イベントを選択 */
  onToggle(eventId: string, checked: boolean) {
    if (checked) {
      this.selectedEvents.add(eventId);
    } else {
      this.selectedEvents.delete(eventId);
    }
  }

  /** 全てのイベントを選択 */
  toggleAll() {
    this.createdEvents.forEach(event => {
      this.selectedEvents.add(event.eventId);
    });
  }
  /** 全てのイベントを選択解除 */
  toggleAllClear() {
    this.selectedEvents.clear();
  }


  /** 選択されたイベントを承認 */
  async approveSelected() {
    let count = 0;
    /** 選択されたイベントを承認 */
    for (const employeeId of this.selectedEvents) {
      const event = this.createdEvents.find(event => event.payload?.['employee']?.employeeId === employeeId);
      if (!event) {
        continue;
      } else {
        event.approval = {
          approvalStatus: '承認済み',
          approvedDate: Timestamp.now(),
          approvedBy: this.loginEmployeeId!,
        };
        const eventResult = await this.eventService.updateEvent(employeeId, event.eventId, event);
        if (!eventResult) {
          console.log(`${employeeId}のイベント更新に失敗しました`);
          continue;
        }

        /** 保険適用を行う(employeeサービス) */
        const occurredDate = event.occurredDate?.toDate();
        console.log("occurredDate:", occurredDate);
        const employee:Employee | null = await this.employeeService.getEmployeeByEmployeeId(employeeId);
        if (!employee) {
          continue;
        }
        let updateEmployee:Partial<Employee> = {};
        switch (event.reachAgeType) {
          case '40歳':
            updateEmployee = {
              ...employee!,
              insurance: {
                ...employee!.insurance,
                nursingCareInsurance: {
                  joined: true,
                  acquiredDate: Timestamp.fromDate(occurredDate!),
                }
              },
            };
            break;
          case '65歳':
            updateEmployee = {
              ...employee!,
              insurance: {
                ...employee!.insurance,
                nursingCareInsurance: {
                  joined: false,
                  lostDate: Timestamp.fromDate(occurredDate!),
                }
              },
            };
            break;
          case '70歳':
            updateEmployee = {
              ...employee!,
              insurance: {
                ...employee!.insurance,
                employeePensionInsurance: {
                  joined: false,
                  lostDate: Timestamp.fromDate(occurredDate!),
                }
              },
            };
            break;
          case '75歳':
            updateEmployee = {
              ...employee!,
              insurance: {
                ...employee!.insurance,
                healthInsurance: {
                  joined: false,
                  lostDate: Timestamp.fromDate(occurredDate!),
                }
              },
            };
            break;
        }

        const employeeResult = await this.employeeService.updateEmployee(updateEmployee);
        if (!employeeResult) {
          console.log(`${employeeId}の社員更新に失敗しました`);
          continue;
        }
        count++;

      }
    }
  }
}