import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { Employee } from '../../model/employee';
import { Event } from '../../model/event';
import { CommonService } from '../common/common-service';

/** イベント詳細モーダル用の変更内容表示 */
@Injectable({
  providedIn: 'root',
})
export class EmployeeEventDisplayService {

  private commonService = inject(CommonService);

  getChangeLines(event: Event): string[] {
    const payload = event.payload ?? {};
    const before = payload['before'];
    const after = payload['after'];

    if (event.eventType === '氏名変更') {
      return [`姓：${before ?? '—'} → ${after ?? '—'}`];
    }

    if (event.eventType === '扶養情報変更') {
      const beforeDep = before as Record<string, unknown> | null;
      const afterDep = after as Record<string, unknown>;
      const lines = [
        `氏名：${beforeDep?.['name'] ?? '—'} → ${afterDep?.['name'] ?? '—'}`,
        `続柄：${beforeDep?.['relationship'] ?? '—'} → ${afterDep?.['relationship'] ?? '—'}`,
        `生年月日：${this.commonService.formatDate(beforeDep?.['birthDate'] as Timestamp) ?? '—'} → ${this.commonService.formatDate(afterDep?.['birthDate'] as Timestamp) ?? '—'}`,
        `扶養状況：${beforeDep?.['isDependent'] ? '対象' : '対象外'} → ${afterDep?.['isDependent'] ? '対象' : '対象外'}`,
      ];
      return lines;
    }

    const beforeEmployee = before as Employee | undefined;
    const afterEmployee = after as Employee | undefined;

    if (event.eventType === '固定給変更') {
      return [`固定給：${beforeEmployee?.employmentContract?.fixedSalary ?? '—'}円 → ${afterEmployee?.employmentContract?.fixedSalary ?? '—'}円`];
    }

    if (event.eventType === '雇用形態変更' || event.eventType === '入社') {
      const beforeOffice = beforeEmployee?.employmentContract?.officeId ?? '';
      const afterOffice = afterEmployee?.employmentContract?.officeId ?? '';

      return [
        `雇用形態：${beforeEmployee?.employmentContract?.employmentCategory ?? '—'} → ${afterEmployee?.employmentContract?.employmentCategory ?? '—'}`,
        `勤務スタイル：${beforeEmployee?.employmentContract?.workStyle ?? '—'} → ${afterEmployee?.employmentContract?.workStyle ?? '—'}`,
        `事業所：${this.commonService.getOfficeName(beforeOffice) ?? '—'} → ${this.commonService.getOfficeName(afterOffice) ?? '—'}`,
        `週労働時間：${beforeEmployee?.employmentContract?.contractedWorkingHoursPerWeek ?? '—'} → ${afterEmployee?.employmentContract?.contractedWorkingHoursPerWeek ?? '—'}`,
        `月労働日数：${beforeEmployee?.employmentContract?.contractedWorkingDaysPerMonth ?? '—'} → ${afterEmployee?.employmentContract?.contractedWorkingDaysPerMonth ?? '—'}`,
      ];
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
}
