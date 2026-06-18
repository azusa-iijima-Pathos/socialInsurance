import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { AnnouncementReason, AnnouncementSubType, ChangeType } from '../../constants/model-constants';
import { Employee, EmployeeInsurance } from '../../model/employee';
import { Event } from '../../model/event';
import { Announcement } from '../../model/announcement';
import { SystemCalculationRunItem } from '../Firestore/calculation-run-service';
import { AnnouncementService } from '../Firestore/announcement-service';
import { addMonths, InsuranceChangeKey, isEmploymentChangeSystemRun } from './event-id-service';
import { determineDependentChangeType } from './dependent-change-event.service';

@Injectable({
  providedIn: 'root',
})
export class AnnouncementLogicService {
  private announcementService = inject(AnnouncementService);

  async createFromHireRun(run: SystemCalculationRunItem): Promise<void> {
    await this.createAnnouncement({
      announcementId: this.buildAnnouncementId('insurance_run', run.runId),
      type: '保険変更',
      subType: '取得',
      reason: '入社',
      occurredDate: this.resolveInsuranceRunOccurredDate(run, '取得'),
      employeeId: run.employeeId,
      sourceKind: 'calculationRun',
      sourceId: run.runId,
    });
  }

  async createFromRetireRun(run: SystemCalculationRunItem): Promise<void> {
    await this.createAnnouncement({
      announcementId: this.buildAnnouncementId('insurance_run', run.runId),
      type: '保険変更',
      subType: '喪失',
      reason: '退社',
      occurredDate: this.resolveInsuranceRunOccurredDate(run, '喪失'),
      employeeId: run.employeeId,
      sourceKind: 'calculationRun',
      sourceId: run.runId,
    });
  }

  async createFromEmploymentChangeRun(run: SystemCalculationRunItem): Promise<void> {
    if (!isEmploymentChangeSystemRun(run)) return;
    const subType: AnnouncementSubType = run.type === '資格喪失' ? '喪失' : '取得';
    await this.createAnnouncement({
      announcementId: this.buildAnnouncementId('insurance_run', run.runId),
      type: '保険変更',
      subType,
      reason: '雇用契約情報変更',
      occurredDate: this.resolveInsuranceRunOccurredDate(run, subType),
      employeeId: run.employeeId,
      sourceKind: 'calculationRun',
      sourceId: run.runId,
    });
  }

  async createFromFixedSalaryRun(run: SystemCalculationRunItem): Promise<void> {
    await this.createAnnouncement({
      announcementId: this.buildAnnouncementId('fixed_salary_run', run.runId),
      type: '随時改定',
      subType: '変更',
      occurredDate: this.resolveFixedSalaryOccurredDate(run),
      employeeId: run.employeeId,
      sourceKind: 'calculationRun',
      sourceId: run.runId,
    });
  }

  async createFromDependentEvent(event: Event, employeeId: string): Promise<void> {
    const subType = this.mapDependentChangeSubType(event);
    const reason = this.mapDependentReason(event);
    await this.createAnnouncement({
      announcementId: this.buildAnnouncementId('dependent_event', `${employeeId}_${event.eventId}`),
      type: '扶養変更',
      subType,
      reason,
      occurredDate: event.occurredDate ?? Timestamp.now(),
      employeeId,
      sourceKind: 'event',
      sourceId: event.eventId,
    });
  }

  async createFromLeaveEvent(event: Pick<Event, 'eventId' | 'eventType' | 'payload' | 'occurredDate' | 'lifeEventType'>, employeeId: string): Promise<void> {
    if (!this.isMaternityOrParentalLeaveEvent(event)) return;
    const reason = this.mapLeaveReason(event);
    await this.createAnnouncement({
      announcementId: this.buildAnnouncementId('leave_event', `${employeeId}_${event.eventId}`),
      type: '産休育休',
      subType: '変更',
      reason,
      occurredDate: this.resolveLeaveOccurredDate(event),
      employeeId,
      sourceKind: 'event',
      sourceId: event.eventId,
    });
  }

  async createFromBonusConfirmation(payrollId: string): Promise<void> {
    await this.createAnnouncement({
      announcementId: this.buildAnnouncementId('bonus', payrollId),
      type: '賞与保険',
      subType: '変更',
      occurredDate: Timestamp.now(),
      sourceKind: 'bonus',
      sourceId: payrollId,
    });
  }

  async createFromCalculationBaseApproval(year: number): Promise<void> {
    await this.createAnnouncement({
      announcementId: this.buildAnnouncementId('calculation_base', String(year)),
      type: '算定基礎',
      subType: '変更',
      occurredDate: Timestamp.fromDate(new Date(year, 6, 1)),
      sourceKind: 'calculationBase',
      sourceId: String(year),
    });
  }

  private async createAnnouncement(data: Omit<Announcement, 'checked' | 'createdAt' | 'updatedAt'>): Promise<void> {
    await this.announcementService.createAnnouncement({
      ...data,
      checked: false,
    });
  }

  private buildAnnouncementId(prefix: string, sourceId: string): string {
    const sanitized = sourceId.replace(/[\/\\]/g, '_');
    return `announce_${prefix}_${sanitized}`;
  }

  private resolveInsuranceRunOccurredDate(
    run: SystemCalculationRunItem,
    kind: '取得' | '喪失',
  ): Timestamp {
    const after = this.extractInsurancePayload(run.payload?.['after']);
    if (after) {
      const keys = String(run.payload?.['insuranceKey'] ?? '')
        .split(',')
        .map(key => key.trim())
        .filter(Boolean) as InsuranceChangeKey[];
      const targetKeys: InsuranceChangeKey[] = keys.length > 0
        ? keys
        : ['healthInsurance', 'nursingCareInsurance', 'employeePensionInsurance'];
      for (const key of targetKeys) {
        const detail = after[key];
        const date = kind === '喪失' ? detail?.lostDate : detail?.acquiredDate;
        if (date) return date;
      }
    }

    const occurredDate = run.payload?.['occurredDate'] as Timestamp | undefined;
    if (occurredDate) return occurredDate;
    if (run.detectedDate) return run.detectedDate as Timestamp;
    return Timestamp.now();
  }

  private resolveFixedSalaryOccurredDate(run: SystemCalculationRunItem): Timestamp {
    const changeDate = (run.payload?.['occurredDate'] as Timestamp | undefined)?.toDate()
      ?? (run.payload?.['fixedSalaryChangeDate'] as Timestamp | undefined)?.toDate()
      ?? run.detectedDate?.toDate()
      ?? new Date();
    const revision = this.addMonthsPreserveDay(changeDate, 3);
    return Timestamp.fromDate(revision);
  }

  private resolveLeaveOccurredDate(event: Pick<Event, 'payload' | 'occurredDate'>): Timestamp {
    const after = event.payload?.['after'] as Employee | Record<string, unknown> | undefined;
    const leaveStart = after?.['leaveStartDate'] as Timestamp | undefined;
    return leaveStart ?? event.occurredDate ?? Timestamp.now();
  }

  private mapDependentChangeSubType(event: Event): AnnouncementSubType {
    const before = event.payload?.['before'] as { dependents?: unknown[] } | { dependentId?: string } | null | undefined;
    const after = event.payload?.['after'] as { dependents?: unknown[] } | { dependentId?: string; isDependent?: boolean } | undefined;
    if (after && 'dependentId' in after) {
      const changeType = determineDependentChangeType(
        before && 'dependentId' in before ? before as never : null,
        after as never,
      );
      return this.mapChangeTypeToSubType(changeType);
    }
    if (event.changeType === '追加') return '取得';
    if (event.changeType === '削除') return '喪失';
    return '変更';
  }

  private mapChangeTypeToSubType(changeType: ChangeType): AnnouncementSubType {
    if (changeType === '追加') return '取得';
    if (changeType === '削除') return '喪失';
    return '変更';
  }

  private mapDependentReason(event: Event): AnnouncementReason | undefined {
    return this.mapLifeEventReason(event.lifeEventType);
  }

  private mapLeaveReason(event: Pick<Event, 'payload' | 'lifeEventType'>): AnnouncementReason | undefined {
    const after = event.payload?.['after'] as Employee | undefined;
    if (after?.leaveTypes === '産前産後') return '出産';
    if (after?.leaveTypes === '育児') return '育児';
    return this.mapLifeEventReason(event.lifeEventType);
  }

  private mapLifeEventReason(lifeEventType?: string): AnnouncementReason | undefined {
    switch (lifeEventType) {
      case '結婚': return '結婚';
      case '離婚': return '離婚';
      case '出産': return '出産';
      case '育児': return '育児';
      default: return undefined;
    }
  }

  isMaternityOrParentalLeaveEvent(event: Pick<Event, 'eventType' | 'payload'>): boolean {
    if (event.eventType !== '勤務状況変更') return false;
    const after = event.payload?.['after'] as Employee | Record<string, unknown> | undefined;
    const before = event.payload?.['before'] as Employee | Record<string, unknown> | undefined;
    const leaveTypes = after?.['leaveTypes']
      ?? (after as Employee | undefined)?.leaveTypes
      ?? before?.['leaveTypes']
      ?? (before as Employee | undefined)?.leaveTypes;
    return leaveTypes === '産前産後' || leaveTypes === '育児';
  }

  private extractInsurancePayload(payload: unknown): EmployeeInsurance | undefined {
    if (!payload || typeof payload !== 'object') return undefined;
    const data = payload as Record<string, unknown>;
    if (data['insurance']) return data['insurance'] as EmployeeInsurance;
    if (
      'healthInsurance' in data
      || 'nursingCareInsurance' in data
      || 'employeePensionInsurance' in data
      || 'currentGrade' in data
    ) {
      return data as EmployeeInsurance;
    }
    return undefined;
  }

  private addMonthsPreserveDay(date: Date, months: number): Date {
    const next = addMonths(date.getFullYear(), date.getMonth() + 1, months);
    const day = Math.min(
      date.getDate(),
      new Date(next.year, next.month, 0).getDate(),
    );
    return new Date(next.year, next.month - 1, day);
  }
}
