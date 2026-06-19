import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Announcement } from '../../../model/announcement';
import { AnnouncementService } from '../../../service/Firestore/announcement-service';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { CommonService } from '../../../service/common/common-service';
import { InsuranceNumberUnconfirmedList } from '../../employee/insurance-number-unconfirmed-list/insurance-number-unconfirmed-list';

@Component({
  selector: 'app-submission-checklist',
  imports: [CommonModule, RouterLink, InsuranceNumberUnconfirmedList],
  templateUrl: './submission-checklist.html',
  styleUrls: ['./submission-checklist.css', '../../employee/employee-detail/employee-detail.css'],
})
export class SubmissionChecklist implements OnInit {
  private announcementService = inject(AnnouncementService);
  private employeeService = inject(EmployeeService);
  private router = inject(Router);
  commonService = inject(CommonService);

  uncheckedItems: Announcement[] = [];
  checkedItems: Announcement[] = [];
  loading = true;

  async ngOnInit() {
    await this.loadItems();
  }

  async loadItems() {
    this.loading = true;
    await this.employeeService.getAllEmployees();
    const items = await this.announcementService.getAllAnnouncements();
    this.uncheckedItems = items
      .filter(item => !item.checked)
      .sort((left, right) => (left.occurredDate?.toMillis() ?? 0) - (right.occurredDate?.toMillis() ?? 0));
    this.checkedItems = items
      .filter(item => item.checked)
      .sort((left, right) => (right.checkedAt?.toMillis() ?? 0) - (left.checkedAt?.toMillis() ?? 0));
    this.loading = false;
  }

  async markChecked(item: Announcement) {
    const loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? '';
    if (!loginEmployeeId) return;
    const updated = await this.announcementService.markChecked(item.announcementId, loginEmployeeId);
    if (updated) {
      await this.loadItems();
    }
  }

  formatOccurredDate(item: Announcement): string {
    return this.commonService.formatDate(item.occurredDate);
  }

  formatCheckedAt(item: Announcement): string {
    return item.checkedAt ? this.commonService.formatDateTime(item.checkedAt) : '—';
  }

  getCheckerName(item: Announcement): string {
    return this.commonService.getEmployeeName(item.checkedBy ?? '') || '—';
  }

  getEmployeeName(employeeId?: string): string {
    if (!employeeId) return '—';
    return this.commonService.getEmployeeName(employeeId) ?? employeeId;
  }

  getReasonLabel(item: Announcement): string {
    return item.reason ?? '—';
  }

  toMonthlyEventList() {
    this.router.navigate(['/monthly-event-list'], { queryParams: { grouping: 'approved' } });
  }

}
