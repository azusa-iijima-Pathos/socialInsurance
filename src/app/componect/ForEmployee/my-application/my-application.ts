import { Component, inject } from '@angular/core';
import { EventService } from '../../../service/Firestore/event-service';
import { CommonModule } from '@angular/common';
import { CommonService } from '../../../service/common/common-service';
import { Event } from '../../../model/event';
import { Router } from '@angular/router';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { Timestamp } from '@angular/fire/firestore';
import { Employee } from '../../../model/employee';

@Component({
  selector: 'app-my-application',
  imports: [CommonModule],
  templateUrl: './my-application.html',
  styleUrl: './my-application.css',
})
export class MyApplication {

  private eventService = inject(EventService);
  commonService = inject(CommonService);
  router = inject(Router);
  employeeService = inject(EmployeeService);

  loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? '';

  events: Event[] = [];

  approvedEvents: Event[] = [];
  unapprovedEvents: Event[] = [];
  rejectedEvents: Event[] = [];

  async ngOnInit() {

    await this.employeeService.getAllEmployees();

    if (!this.loginEmployeeId) {
      this.router.navigate(['/login']);
      return;
    }
    this.events = await this.eventService.getEmployeeAllEvents(this.loginEmployeeId);
    this.approvedEvents = this.events.filter(event => event.approval?.approvalStatus === '承認済み');
    this.unapprovedEvents = this.events.filter(event => event.approval?.approvalStatus === '申請中');
    this.rejectedEvents = this.events.filter(event => event.approval?.approvalStatus === '却下');
  }

  reviewModalOpen = false;
  reviewingEvent: Event | null = null;
  openReview(event: Event) {
    this.reviewingEvent = event;
    this.reviewModalOpen = true;
  }
  closeReview() {
    this.reviewModalOpen = false;
    this.reviewingEvent = null;
  }

  getEmployeeName(employeeId: string): string {
    return this.commonService.getEmployeeName(employeeId) ?? employeeId;
  }
  getEmployeeEventChangeLines(event: Event): string[] {
    const payload = event.payload ?? {};
    const before = payload['before'];
    const after = payload['after'];

    if (event.eventType === '氏名変更') {
      const lines = [`姓：${before ?? '—'} → ${after ?? '—'}`];
      if (event.appliedDate) {
        lines.push(`適用日：${this.commonService.formatDate(event.appliedDate)}`);
      }
      return lines;
    }

    if (event.eventType === '扶養情報変更') {
      const lines: string[] = [];
      const beforeDep = before as Record<string, unknown> | null;
      const afterDep = after as Record<string, unknown>;
      if (beforeDep) {
        lines.push(`氏名：${beforeDep['name'] ?? '—'} → ${afterDep['name'] ?? '—'}`);
        lines.push(`続柄：${beforeDep['relationship'] ?? '—'} → ${afterDep['relationship'] ?? '—'}`);
        lines.push(`生年月日：${this.formatPayloadDate(beforeDep['birthDate'])} → ${this.formatPayloadDate(afterDep['birthDate'])}`);
        lines.push(`扶養区分：${this.formatDependentFlag(beforeDep['isDependent'])} → ${this.formatDependentFlag(afterDep['isDependent'])}`);
      } else {
        lines.push(`氏名：${afterDep['name'] ?? '—'}（新規）`);
        lines.push(`続柄：${afterDep['relationship'] ?? '—'}`);
        lines.push(`生年月日：${this.formatPayloadDate(afterDep['birthDate'])}`);
        lines.push(`扶養区分：${this.formatDependentFlag(afterDep['isDependent'])}`);
      }
      if (event.lifeEventType) {
        lines.unshift(`申請理由：${event.lifeEventType}`);
      }
      return lines;
    }

    if (event.eventType === '勤務状況変更') {
      const beforeEmp = before as Employee | undefined;
      const afterEmp = after as Employee | undefined;
      const occurredDate = event.occurredDate;
      const expectedBirthDate = event.payload?.['expectedBirthDate'];
      const isMultipleBirth = event.payload?.['isMultipleBirth'] as boolean | undefined;
      console.log(isMultipleBirth);
      console.log(expectedBirthDate);
      const lines: string[] = [];
      if (beforeEmp?.workStatus !== afterEmp?.workStatus) {
        lines.push(`勤務状況：${beforeEmp?.workStatus ?? '—'} → ${afterEmp?.workStatus ?? '—'}`);
      }
      if (beforeEmp?.leaveTypes !== afterEmp?.leaveTypes) {
        lines.push(`休業種別：${beforeEmp?.leaveTypes ?? '—'} → ${afterEmp?.leaveTypes ?? '—'}`);
      }
      if (occurredDate) {
        lines.push(`休職開始日：${this.commonService.formatDate(occurredDate)}`);
      }
      if (expectedBirthDate) {
        if (event.lifeEventType === '出産') {
          lines.push(`出産予定日：${this.commonService.formatDate(expectedBirthDate)}`);
        } else if (event.lifeEventType === '育児') {
          lines.push(`子どもの誕生日：${this.commonService.formatDate(expectedBirthDate)}`);
        }
      }
      if (isMultipleBirth === true) {
        lines.push(`多胎妊娠：○`);
      } else if (isMultipleBirth === false) {
        lines.push(`多胎妊娠：×`);
      }
      if (event.lifeEventType) {
        lines.unshift(`ライフイベント：${event.lifeEventType}`);
      }
      return lines.length ? lines : ['変更内容を確認してください'];
    }

    return ['変更内容を確認してください'];
  }

  private formatPayloadDate(value: unknown): string {
    if (!value) return '—';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null && 'toDate' in value) {
      return (value as Timestamp).toDate().toLocaleDateString();
    }
    return String(value);
  }

  private formatDependentFlag(value: unknown): string {
    return value === false ? '扶養ではない' : '扶養';
  }

  toLifeeventApplication() {
    this.router.navigate(['/lifeevent-application']);
  }





}
