import { Component, inject } from '@angular/core';
import { Employee, InsuranceDetail } from '../../../model/employee';
import { Dependent } from '../../../model/dependent';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { DependentService } from '../../../service/Firestore/dependent-service';
import { EventService } from '../../../service/Firestore/event-service';
import { Router } from '@angular/router';
import { CommonService } from '../../../service/common/common-service';
import { InsuranceFormService } from '../../../service/logic/insurance-form.service';
import {
  EmployeeDetailEventService,
  ScheduledLeaveInfo,
} from '../../../service/logic/employee-detail-event-service';
import { CommonModule } from '@angular/common';
import { Timestamp } from '@angular/fire/firestore';

@Component({
  selector: 'app-my-insurance-detail',
  imports: [CommonModule],
  templateUrl: './my-insurance-detail.html',
  styleUrls: [
    './my-insurance-detail.css',
    '../../employee/employee-detail/employee-detail.css',
  ],
})
export class MyInsuranceDetail {

  private employeeService = inject(EmployeeService);
  private dependentService = inject(DependentService);
  private eventService = inject(EventService);
  private employeeDetailEventService = inject(EmployeeDetailEventService);
  private router = inject(Router);
  private insuranceFormService = inject(InsuranceFormService);
  commonService = inject(CommonService);

  loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? '';
  employee: Employee | null = null;
  dependents: Dependent[] = [];
  scheduledLeaveInfo: ScheduledLeaveInfo | null = null;

  async ngOnInit() {
    this.employee = await this.employeeService.getEmployeeByEmployeeId(this.loginEmployeeId);
    if (!this.employee) {
      this.router.navigate(['/login']);
      return;
    }

    this.dependents = await this.dependentService.getDependents(this.loginEmployeeId);
    const events = await this.eventService.getEmployeeEventsUpToWorkingMonth(this.loginEmployeeId);
    this.scheduledLeaveInfo = this.employeeDetailEventService.getScheduledLeaveInfo(
      events,
      this.employee.workStatus,
    );
  }

  getInsuranceStatus(insuranceDetail?: InsuranceDetail): string {
    if (!insuranceDetail) return '未登録';
    return this.insuranceFormService.getStatusForDisplay(insuranceDetail);
  }

  showInsuranceDetail(detail?: InsuranceDetail): boolean {
    if (!detail) return false;
    return detail.joined === true || !!detail.lostDate || !!detail.number || !!detail.acquiredDate;
  }

  isInsuranceNumberMissing(detail?: InsuranceDetail, sharedNumber?: string): boolean {
    return this.insuranceFormService.isInsuranceNumberMissing(detail, sharedNumber);
  }

  getDependentStatusLabel(isDependent?: boolean): string {
    return isDependent !== false ? '扶養対象' : '扶養対象外';
  }

  formatScheduledLeave(info: ScheduledLeaveInfo): string {
    const start = this.formatScheduledLeaveMonthDay(info.leaveStartDate);
    if (info.leaveEndDate) {
      const end = this.formatScheduledLeaveMonthDay(info.leaveEndDate);
      return `${start}～${end}まで予定`;
    }
    return `${start}～予定`;
  }

  formatScheduledLeavePeriod(info: ScheduledLeaveInfo): string {
    const start = this.commonService.formatDate(info.leaveStartDate);
    const end = info.leaveEndDate ? this.commonService.formatDate(info.leaveEndDate) : '';
    return end ? `${start}～${end}` : `${start}～`;
  }

  private formatScheduledLeaveMonthDay(date: Timestamp): string {
    const value = date.toDate();
    return `${value.getMonth() + 1}月${value.getDate()}日`;
  }

}
