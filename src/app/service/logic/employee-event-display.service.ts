import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Employee } from '../../model/employee';
import { Dependent } from '../../model/dependent';
import { Event } from '../../model/event';
import { CommonService } from '../common/common-service';
import { OfficeService } from '../Firestore/office-service';

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
      return this.getDependentChangeLines(before, after, event.lifeEventType);
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
      return [`固定給：${beforeEmployee?.employmentContract?.fixedSalary ?? '—'}円 → ${afterEmployee?.employmentContract?.fixedSalary ?? '—'}円`];
    }

    if (event.eventType === '入社') {
      const hireEmployee = payload['employee'] as Employee | undefined;
      return this.getEmploymentChangeLines(undefined, hireEmployee);
    }

    if (event.eventType === '雇用形態変更') {
      return this.getEmploymentChangeLines(beforeEmployee, afterEmployee);
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

  private getDependentChangeLines(before: unknown, after: unknown, lifeEventType?: string): string[] {
    if (this.isDependentArrayPayload(before) || this.isDependentArrayPayload(after)) {
      const beforeDeps = this.extractDependents(before);
      const afterDeps = this.extractDependents(after);
      const lines: string[] = [];
      const maxLength = Math.max(beforeDeps.length, afterDeps.length);
      for (let i = 0; i < maxLength; i++) {
        const beforeDep = beforeDeps[i] ?? null;
        const afterDep = afterDeps[i] ?? null;
        lines.push(...this.formatSingleDependentChangeLines(beforeDep, afterDep));
        if (i < maxLength - 1) {
          lines.push('—');
        }
      }
      if (lifeEventType) {
        lines.unshift(`ライフイベント：${lifeEventType}`);
      }
      return lines.length ? lines : ['変更内容を確認してください'];
    }

    const beforeDep = this.extractDependent(before);
    const afterDep = this.extractDependent(after);
    const lines = this.formatSingleDependentChangeLines(beforeDep, afterDep);
    if (lifeEventType) {
      lines.unshift(`ライフイベント：${lifeEventType}`);
    }
    return lines.length ? lines : ['変更内容を確認してください'];
  }

  private formatSingleDependentChangeLines(beforeDep: Dependent | null, afterDep: Dependent | null): string[] {
    if (beforeDep) {
      return [
        `氏名：${this.formatText(beforeDep.name)} → ${this.formatText(afterDep?.name)}`,
        `続柄：${this.formatText(beforeDep.relationship)} → ${this.formatText(afterDep?.relationship)}`,
        `生年月日：${this.formatPayloadDate(beforeDep.birthDate)} → ${this.formatPayloadDate(afterDep?.birthDate)}`,
        `扶養状況：${this.formatDependentFlag(beforeDep.isDependent)} → ${this.formatDependentFlag(afterDep?.isDependent)}`,
      ];
    }

    if (afterDep) {
      return [
        `氏名：${this.formatText(afterDep.name)}（新規）`,
        `続柄：${this.formatText(afterDep.relationship)}`,
        `生年月日：${this.formatPayloadDate(afterDep.birthDate)}`,
        `扶養状況：${this.formatDependentFlag(afterDep.isDependent)}`,
      ];
    }

    return ['変更内容を確認してください'];
  }

  private getEmploymentChangeLines(
    beforeEmployee: Employee | undefined,
    afterEmployee: Employee | undefined,
  ): string[] {
    const beforeOffice = beforeEmployee?.employmentContract?.officeId ?? '';
    const afterOffice = afterEmployee?.employmentContract?.officeId ?? '';

    return [
      `雇用形態：${beforeEmployee?.employmentContract?.employmentCategory ?? '—'} → ${afterEmployee?.employmentContract?.employmentCategory ?? '—'}`,
      `勤務スタイル：${beforeEmployee?.employmentContract?.workStyle ?? '—'} → ${afterEmployee?.employmentContract?.workStyle ?? '—'}`,
      `事業所：${this.formatOfficeName(beforeOffice)} → ${this.formatOfficeName(afterOffice)}`,
      `週労働時間：${this.formatNumber(beforeEmployee?.employmentContract?.contractedWorkingHoursPerWeek)} → ${this.formatNumber(afterEmployee?.employmentContract?.contractedWorkingHoursPerWeek)}`,
      `月労働日数：${this.formatNumber(beforeEmployee?.employmentContract?.contractedWorkingDaysPerMonth)} → ${this.formatNumber(afterEmployee?.employmentContract?.contractedWorkingDaysPerMonth)}`,
    ];
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
    const lines: string[] = [];

    if (beforeEmp?.workStatus !== afterEmp?.workStatus) {
      lines.push(`勤務状況：${beforeEmp?.workStatus ?? '—'} → ${afterEmp?.workStatus ?? '—'}`);
    }
    if (beforeEmp?.leaveTypes !== afterEmp?.leaveTypes) {
      lines.push(`休業種別：${beforeEmp?.leaveTypes ?? '—'} → ${afterEmp?.leaveTypes ?? '—'}`);
    }
    if (event.occurredDate) {
      lines.push(`休職開始日：${this.commonService.formatDate(event.occurredDate)}`);
    }
    if (expectedBirthDate) {
      if (event.lifeEventType === '出産') {
        lines.push(`出産予定日：${this.formatPayloadDate(expectedBirthDate)}`);
      } else if (event.lifeEventType === '育児') {
        lines.push(`子どもの誕生日：${this.formatPayloadDate(expectedBirthDate)}`);
      }
    }
    if (isMultipleBirth === true) {
      lines.push('多胎妊娠：○');
    } else if (isMultipleBirth === false) {
      lines.push('多胎妊娠：×');
    }
    if (event.lifeEventType) {
      lines.unshift(`ライフイベント：${event.lifeEventType}`);
    }
    return lines.length ? lines : ['変更内容を確認してください'];
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
