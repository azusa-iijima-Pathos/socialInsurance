import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Employee, EmploymentContract } from '../../model/employee';
import { Dependent } from '../../model/dependent';
import { Event } from '../../model/event';
import { CommonService } from '../common/common-service';
import { OfficeService } from '../Firestore/office-service';
import {
  formatDisabilityForDisplay,
  formatStudentForDisplay,
} from '../common/dependent-field.util';

type RevisionSummary = {
  currentGrade?: number;
  approvedGrade?: number;
  averageSalary?: number;
};

/** イベント詳細モーダル用の変更内容表示 */
@Injectable({
  providedIn: 'root',
})
export class EmployeeEventDisplayService {

  private commonService = inject(CommonService);
  private officeService = inject(OfficeService);

  getChangeLines(event: Event): string[] {
    const payload = event.payload ?? {};
    const before = payload['before'];
    const after = payload['after'];

    if (event.eventType === '氏名変更') {
      return [`姓：${this.formatText(before)} → ${this.formatText(after)}`];
    }

    if (event.eventType === '扶養情報変更') {
      return this.getDependentChangeLines(
        before,
        after,
        event.lifeEventType,
        event.changeType,
        payload['appliedDate'],
      );
    }

    if (event.eventType === '勤務状況変更') {
      return this.getWorkStatusChangeLines(event, before as Employee | undefined, after as Employee | undefined);
    }

    const beforeEmployee = before as Employee | undefined;
    const afterEmployee = after as Employee | undefined;

    if (event.eventType === '固定給変更') {
      const summary = payload['revisionSummary'] as RevisionSummary | undefined;
      if (summary) {
        return [
          `変更前等級：${summary.currentGrade ?? '—'}`,
          `変更後等級：${summary.approvedGrade ?? '—'}`,
          `平均総支給額：${summary.averageSalary !== undefined ? `${summary.averageSalary.toLocaleString()}円` : '—'}`,
        ];
      }
      const beforeSalary = typeof before === 'number' ? before : beforeEmployee?.employmentContract?.fixedSalary;
      const afterSalary = typeof after === 'number' ? after : afterEmployee?.employmentContract?.fixedSalary;
      return [`固定給：${beforeSalary ?? '—'}円 → ${afterSalary ?? '—'}円`];
    }

    if (event.eventType === '入社') {
      const hireEmployee = payload['employee'] as Employee | undefined;
      return this.getEmploymentChangeLines(undefined, hireEmployee);
    }

    if (event.eventType === '雇用形態変更') {
      const beforeContract = this.isEmploymentContractPayload(before)
        ? before
        : beforeEmployee?.employmentContract;
      const afterContract = this.isEmploymentContractPayload(after)
        ? after
        : afterEmployee?.employmentContract;
      return this.getEmploymentContractChangeLines(beforeContract, afterContract);
    }

    if (event.eventType === '退社') {
      return [`勤務状況：${beforeEmployee?.workStatus ?? '—'} → ${afterEmployee?.workStatus ?? '—'}`];
    }

    if (event.eventType === '一定年齢到達') {
      return [`一定年齢到達：${event.reachAgeType ?? '—'}`];
    }

    return [
      `勤務状況：${beforeEmployee?.workStatus ?? '—'} → ${afterEmployee?.workStatus ?? '—'}`,
      `休職種別：${beforeEmployee?.leaveTypes ?? '—'} → ${afterEmployee?.leaveTypes ?? '—'}`,
    ];
  }

  private getDependentChangeLines(
    before: unknown,
    after: unknown,
    lifeEventType?: string,
    changeType?: string,
    appliedDate?: Timestamp,
  ): string[] {
    const headerLines: string[] = [];
    if (changeType) {
      headerLines.push(`変更タイプ：${changeType}`);
    }
    if (appliedDate) {
      headerLines.push(`適用日：${this.formatPayloadDate(appliedDate)}`);
    }
    if (lifeEventType) {
      headerLines.push(`ライフイベント：${lifeEventType}`);
    }

    if (this.isDependentArrayPayload(before) || this.isDependentArrayPayload(after)) {
      const beforeDeps = this.extractDependents(before);
      const afterDeps = this.extractDependents(after);
      const lines: string[] = [...headerLines];
      const maxLength = Math.max(beforeDeps.length, afterDeps.length);
      for (let i = 0; i < maxLength; i++) {
        const beforeDep = beforeDeps[i] ?? null;
        const afterDep = afterDeps[i] ?? null;
        lines.push(...this.formatSingleDependentChangeLines(beforeDep, afterDep));
        if (i < maxLength - 1) {
          lines.push('—');
        }
      }
      return lines.length ? lines : ['変更内容を確認してください'];
    }

    const beforeDep = this.extractDependent(before);
    const afterDep = this.extractDependent(after);
    const lines = [...headerLines, ...this.formatSingleDependentChangeLines(beforeDep, afterDep)];
    return lines.length ? lines : ['変更内容を確認してください'];
  }

  private formatSingleDependentChangeLines(beforeDep: Dependent | null, afterDep: Dependent | null): string[] {
    if (beforeDep) {
      return [
        `氏名：${this.formatText(beforeDep.name)} → ${this.formatText(afterDep?.name)}`,
        `続柄：${this.formatText(beforeDep.relationship)} → ${this.formatText(afterDep?.relationship)}`,
        `生年月日：${this.formatPayloadDate(beforeDep.birthDate)} → ${this.formatPayloadDate(afterDep?.birthDate)}`,
        `扶養状況：${this.formatDependentFlag(beforeDep.isDependent)} → ${this.formatDependentFlag(afterDep?.isDependent)}`,
        ...this.formatDependentExtraChangeLines(beforeDep, afterDep),
      ];
    }

    if (afterDep) {
      return [
        `氏名：${this.formatText(afterDep.name)}（新規）`,
        `続柄：${this.formatText(afterDep.relationship)}`,
        `生年月日：${this.formatPayloadDate(afterDep.birthDate)}`,
        `扶養状況：${this.formatDependentFlag(afterDep.isDependent)}`,
        ...this.formatDependentExtraLines(afterDep),
      ];
    }

    return ['変更内容を確認してください'];
  }

  private formatDependentExtraChangeLines(beforeDep: Dependent, afterDep: Dependent | null): string[] {
    const after = afterDep ?? ({} as Dependent);
    return [
      `同居・別居：${this.formatText(beforeDep.cohabitationType)} → ${this.formatText(after.cohabitationType)}`,
      `収入額（年収見込み）：${this.formatIncome(beforeDep.annualIncome)} → ${this.formatIncome(after.annualIncome)}`,
      `職業：${this.formatText(beforeDep.occupation)} → ${this.formatText(after.occupation)}`,
      `障害：${formatDisabilityForDisplay(beforeDep)} → ${formatDisabilityForDisplay(afterDep)}`,
      `学生：${formatStudentForDisplay(beforeDep)} → ${formatStudentForDisplay(afterDep)}`,
    ];
  }

  private formatDependentExtraLines(dependent: Dependent): string[] {
    return [
      `同居・別居：${this.formatText(dependent.cohabitationType)}`,
      `収入額（年収見込み）：${this.formatIncome(dependent.annualIncome)}`,
      `職業：${this.formatText(dependent.occupation)}`,
      `障害：${formatDisabilityForDisplay(dependent)}`,
      `学生：${formatStudentForDisplay(dependent)}`,
    ];
  }

  private formatIncome(value: number | undefined): string {
    return value !== undefined && value !== null ? `${value.toLocaleString()}円` : '—';
  }

  private getEmploymentChangeLines(
    beforeEmployee: Employee | undefined,
    afterEmployee: Employee | undefined,
  ): string[] {
    return this.getEmploymentContractChangeLines(
      beforeEmployee?.employmentContract,
      afterEmployee?.employmentContract,
    );
  }

  private getEmploymentContractChangeLines(
    beforeContract: EmploymentContract | undefined,
    afterContract: EmploymentContract | undefined,
  ): string[] {
    const beforeOffice = beforeContract?.officeId ?? '';
    const afterOffice = afterContract?.officeId ?? '';

    return [
      `雇用形態：${beforeContract?.employmentCategory ?? '—'} → ${afterContract?.employmentCategory ?? '—'}`,
      `勤務スタイル：${beforeContract?.workStyle ?? '—'} → ${afterContract?.workStyle ?? '—'}`,
      `事業所：${this.formatOfficeName(beforeOffice)} → ${this.formatOfficeName(afterOffice)}`,
      `週労働時間：${this.formatNumber(beforeContract?.contractedWorkingHoursPerWeek)} → ${this.formatNumber(afterContract?.contractedWorkingHoursPerWeek)}`,
      `月労働日数：${this.formatNumber(beforeContract?.contractedWorkingDaysPerMonth)} → ${this.formatNumber(afterContract?.contractedWorkingDaysPerMonth)}`,
    ];
  }

  private isEmploymentContractPayload(value: unknown): value is EmploymentContract {
    return !!value && typeof value === 'object' && 'employmentCategory' in (value as object);
  }

  private formatOfficeName(officeId: string): string {
    if (!officeId) return '—';
    const mapped = this.commonService.getOfficeName(officeId);
    if (mapped && mapped !== '未定') return mapped;
    const office = this.officeService.allOffices().find(item => item.officeId === officeId);
    return office?.name ?? officeId;
  }

  private formatNumber(value: number | undefined): string {
    return value !== undefined && value !== null ? String(value) : '—';
  }

  private getWorkStatusChangeLines(
    event: Event,
    beforeEmp: Employee | undefined,
    afterEmp: Employee | undefined,
  ): string[] {
    const expectedBirthDate = event.payload?.['expectedBirthDate'];
    const isMultipleBirth = event.payload?.['isMultipleBirth'] as boolean | undefined;
    const childName = event.payload?.['childName'] as string | undefined;
    const beforePayload = event.payload?.['before'] as Record<string, unknown> | undefined;
    const afterPayload = event.payload?.['after'] as Record<string, unknown> | undefined;
    const leaveTypes = this.resolveLeaveTypes(beforeEmp, afterEmp, beforePayload, afterPayload);
    const lines: string[] = [];

    if (event.changeType) {
      lines.push(`変更タイプ：${event.changeType}`);
    }

    if (event.changeType === '休職開始') {
      lines.push(`勤務状況：${this.formatText(beforePayload?.['workStatus'] ?? beforeEmp?.workStatus)} → 休職中`);
    } else if (event.changeType === '休職終了') {
      lines.push(`勤務状況：休職中 → 通常勤務`);
    } else if (beforeEmp?.workStatus !== afterEmp?.workStatus) {
      lines.push(`勤務状況：${beforeEmp?.workStatus ?? '—'} → ${afterEmp?.workStatus ?? '—'}`);
    }

    if (leaveTypes) {
      lines.push(`休業種別：${this.formatText(leaveTypes)}`);
    }

    const leaveStartDate = this.resolveLeaveStartDate(event, beforePayload, afterPayload);
    const leaveEndDate = this.resolveLeaveEndDate(event, beforePayload, afterPayload);
    if (leaveStartDate) {
      lines.push(`休職開始日：${this.formatPayloadDate(leaveStartDate)}`);
    }
    if (leaveEndDate) {
      const endLabel = event.changeType === '休職終了' ? '休職終了日' : '終了予定日';
      lines.push(`${endLabel}：${this.formatPayloadDate(leaveEndDate)}`);
    }

    if (this.isMaternityOrParentalLeave(leaveTypes) && expectedBirthDate) {
      if (leaveTypes === '産前産後' || event.lifeEventType === '出産') {
        lines.push(`出産予定日：${this.formatPayloadDate(expectedBirthDate)}`);
      } else {
        lines.push(`子どもの誕生日：${this.formatPayloadDate(expectedBirthDate)}`);
      }
    }
    if (leaveTypes === '産前産後' && isMultipleBirth !== undefined) {
      lines.push(`多胎妊娠：${isMultipleBirth ? '○' : '×'}`);
    }
    if (leaveTypes === '育児' && childName) {
      lines.push(`子どもの名前：${this.formatText(childName)}`);
    }
    if (event.lifeEventType) {
      lines.push(`ライフイベント：${event.lifeEventType}`);
    }

    return lines.length ? lines : ['変更内容を確認してください'];
  }

  private resolveLeaveTypes(
    beforeEmp: Employee | undefined,
    afterEmp: Employee | undefined,
    beforePayload?: Record<string, unknown>,
    afterPayload?: Record<string, unknown>,
  ): string | undefined {
    const value = afterPayload?.['leaveTypes']
      ?? beforePayload?.['leaveTypes']
      ?? afterEmp?.leaveTypes
      ?? beforeEmp?.leaveTypes;
    return value ? String(value) : undefined;
  }

  private isMaternityOrParentalLeave(leaveTypes?: string): boolean {
    return leaveTypes === '産前産後' || leaveTypes === '育児';
  }

  private resolveLeaveStartDate(
    event: Event,
    beforePayload?: Record<string, unknown>,
    afterPayload?: Record<string, unknown>,
  ): unknown {
    return afterPayload?.['leaveStartDate']
      ?? beforePayload?.['leaveStartDate']
      ?? (event.changeType === '休職開始' ? event.occurredDate : undefined);
  }

  private resolveLeaveEndDate(
    event: Event,
    beforePayload?: Record<string, unknown>,
    afterPayload?: Record<string, unknown>,
  ): unknown {
    return afterPayload?.['leaveEndDate']
      ?? beforePayload?.['leaveEndDate']
      ?? (event.changeType === '休職終了' ? event.occurredDate : undefined);
  }

  private isDependentArrayPayload(value: unknown): value is { dependents: Dependent[] } {
    return !!value && typeof value === 'object' && Array.isArray((value as { dependents?: unknown }).dependents);
  }

  private extractDependents(value: unknown): Dependent[] {
    if (this.isDependentArrayPayload(value)) {
      return value.dependents;
    }
    const single = this.extractDependent(value);
    return single ? [single] : [];
  }

  private extractDependent(value: unknown): Dependent | null {
    if (!value || typeof value !== 'object') return null;
    if (this.isDependentArrayPayload(value)) {
      return value.dependents[0] ?? null;
    }
    return value as Dependent;
  }

  private formatText(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    return String(value);
  }

  private formatPayloadDate(value: unknown): string {
    if (!value) return '—';
    if (typeof value === 'string') return value || '—';

    if (typeof value === 'object' && value !== null) {
      if ('toDate' in value && typeof (value as Timestamp).toDate === 'function') {
        return (value as Timestamp).toDate().toLocaleDateString();
      }
      if ('seconds' in value && typeof (value as { seconds: number }).seconds === 'number') {
        return new Date((value as { seconds: number }).seconds * 1000).toLocaleDateString();
      }
    }

    return '—';
  }

  private formatDependentFlag(value: unknown): string {
    if (value === false) return '対象外';
    if (value === true) return '対象';
    return '—';
  }
}
