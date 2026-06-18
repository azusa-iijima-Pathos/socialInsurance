import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { timestampFromDateInput } from '../common/date-input.util';
import { Employee, EmployeeInsurance, InsuranceDetail } from '../../model/employee';
import { Event } from '../../model/event';
import { EmployeeService } from '../Firestore/employee-service';
import { EventService } from '../Firestore/event-service';
import { CompanyService } from '../Firestore/company-service';
import { EmployeeLogicService } from './employee-logic-service';
import { DependentService } from '../Firestore/dependent-service';
import { Dependent } from '../../model/dependent';
import {
  getDependentDisabilityStudentFormDefaults,
  mapDependentDisabilityStudentFromForm,
} from '../common/dependent-field.util';
import { Relationship, CohabitationType, DisabilityType, StudentType } from '../../constants/model-constants';
import { CalculationRunService } from '../Firestore/calculation-run-service';
import { SystemCalculationRunItem } from '../Firestore/calculation-run-service';
import { UserService } from '../Firestore/user-service';
import { EmployeeDetailEventService } from './employee-detail-event-service';
import { DependentChangeEventService } from './dependent-change-event.service';
import { InsuranceFormService } from './insurance-form.service';
import { AnnouncementLogicService } from './announcement-logic.service';
import { getCurrentAppliedFromMonth, getQualificationLossTimestamp, getWorkMonthForDate, getWorkingYearMonth, InsuranceChangeKey, isEmploymentChangeSystemRun } from './event-id-service';

type InsuranceStatusKind = 'joined' | 'notJoined' | 'lost';

export type FixedSalaryApprovalDraft = {
  occurredDate: Timestamp;
  currentGrade: number;
  revisionLabel: string;
  approvedGrade: number;
  canRevise: boolean;
  averageSalary?: number;
  targetPayrolls?: {
    payrollId: string;
    actualWorkingDays?: number;
    actualPaymentAmount?: number;
  }[];
};

export type InsuranceApprovalDraft = {
  currentGrade: number;
  autoGrade: number | null;
  approvedGrade: number;
  currentHealthStatus: InsuranceStatusKind;
  currentNursingStatus: InsuranceStatusKind;
  currentPensionStatus: InsuranceStatusKind;
  healthStatus: InsuranceStatusKind;
  nursingStatus: InsuranceStatusKind;
  pensionStatus: InsuranceStatusKind;
  healthAcquiredDate: string;
  healthLostDate: string;
  nursingAcquiredDate: string;
  nursingLostDate: string;
  pensionAcquiredDate: string;
  pensionLostDate: string;
};

export type InsuranceChangeDetailItem = {
  insuranceName: string;
  changeTypeLabel: string;
  dateLabel: string;
  dateValue: string;
};

export type HireInsuranceDetailView = {
  currentGrade: number;
  basicPensionNumber?: string;
  healthInsurance: InsuranceDetail;
  nursingCareInsurance: InsuranceDetail;
  employeePensionInsurance: InsuranceDetail;
  dependents: Partial<Dependent>[];
};

export type HireDependentApprovalDraft = {
  eventId: string;
  dependentId: string;
  name: string;
  birthDate: string;
  relationship: Relationship | '';
  dependentStartDate: string;
  cohabitationType: CohabitationType | '';
  annualIncome: number | '';
  occupation: string;
  disabilityStatus: 'あり' | 'なし' | '';
  disabilityType: DisabilityType | '';
  studentStatus: '学生' | '学生じゃない' | '';
  studentType: StudentType | '';
};

export type HireInsuranceApprovalDraft = {
  currentGrade: number;
  autoGrade: number | null;
  basicPensionNumber: string;
  healthJoined: boolean;
  healthAcquiredDate: string;
  healthCompanyBurdenRate: number;
  nursingJoined: boolean;
  nursingAcquiredDate: string;
  nursingCompanyBurdenRate: number;
  pensionJoined: boolean;
  pensionAcquiredDate: string;
  pensionCompanyBurdenRate: number;
  dependents: HireDependentApprovalDraft[];
};

export type RetireInsuranceDetailView = {
  resignationDate?: Timestamp;
  qualificationLossDate?: Timestamp;
  currentGrade: number;
  healthInsurance: InsuranceDetail;
  nursingCareInsurance: InsuranceDetail;
  employeePensionInsurance: InsuranceDetail;
  dependents: Partial<Dependent>[];
};

@Injectable({
  providedIn: 'root',
})
export class EmployeeEventApprovalService {

  private employeeService = inject(EmployeeService);
  private eventService = inject(EventService);
  private companyService = inject(CompanyService);
  private employeeLogicService = inject(EmployeeLogicService);
  private dependentService = inject(DependentService);
  private calculationRunService = inject(CalculationRunService);
  private userService = inject(UserService);
  private employeeDetailEventService = inject(EmployeeDetailEventService);
  private dependentChangeEventService = inject(DependentChangeEventService);
  private insuranceFormService = inject(InsuranceFormService);
  private announcementLogicService = inject(AnnouncementLogicService);

  private async enqueueAnnouncement(task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (error) {
      console.error('届け出チェックリストの作成に失敗しました', error);
    }
  }

  private async enqueueAnnouncementAfterEventApplied(employeeId: string, event: Event): Promise<void> {
    if (event.eventType === '扶養情報変更') {
      await this.enqueueAnnouncement(() => this.announcementLogicService.createFromDependentEvent(event, employeeId));
      return;
    }
    if (event.eventType === '勤務状況変更' && this.announcementLogicService.isMaternityOrParentalLeaveEvent(event)) {
      await this.enqueueAnnouncement(() => this.announcementLogicService.createFromLeaveEvent(event, employeeId));
    }
  }

  async buildFixedSalaryApprovalDraft(event: Event): Promise<FixedSalaryApprovalDraft | null> {
    const after = event.payload?.['after'] as Employee | undefined;
    if (!after) return null;

    const currentGrade = after.insurance?.currentGrade ?? 0;
    const changeMonth = this.getFixedSalaryChangeMonth(event);
    const revision = await this.employeeLogicService.getAdHocRevisionResult(after, changeMonth);

    if (revision.status === '判定不可') {
      return {
        currentGrade,
        occurredDate: event.occurredDate!,
        revisionLabel: `判定不可のため等級変更なし${revision.reason ? `（${revision.reason}）` : ''}`,
        approvedGrade: currentGrade,
        canRevise: false,
        averageSalary: revision.averageSalary,
        targetPayrolls: revision.targetPayrolls ?? [],
      };
    }

    if (revision.status === '変更なし') {
      return {
        currentGrade,
        revisionLabel: '2等級以上の変更なし',
        occurredDate: event.occurredDate!,
        approvedGrade: currentGrade,
        canRevise: false,
        averageSalary: revision.averageSalary,
        targetPayrolls: revision.targetPayrolls ?? [],
      };
    }

    return {
      currentGrade,
      occurredDate: event.occurredDate!,
      revisionLabel: String(revision.calculatedGrade),
      approvedGrade: revision.calculatedGrade ?? currentGrade,
      canRevise: true,
      averageSalary: revision.averageSalary,
      targetPayrolls: revision.targetPayrolls ?? [],
    };
  }

  async buildInsuranceChangeApprovalDraft(run: SystemCalculationRunItem): Promise<InsuranceApprovalDraft | null> {
    if (isEmploymentChangeSystemRun(run)) {
      return this.buildEmploymentChangeApprovalDraft(run);
    }

    const insuranceKey = String(run.payload?.['insuranceKey'] ?? '') as InsuranceChangeKey | '';
    const beforePartial = this.extractInsurancePayload(run.payload?.['before']);
    const afterPartial = this.extractInsurancePayload(run.payload?.['after']);
    if (!afterPartial) return null;

    const employee = await this.employeeService.getEmployeeByEmployeeId(run.employeeId);
    if (!employee) return null;

    const beforeInsurance = insuranceKey
      ? this.mergeInsuranceChangeSnapshot(employee.insurance, beforePartial, insuranceKey)
      : (beforePartial ?? employee.insurance);
    const afterInsurance = insuranceKey
      ? this.mergeInsuranceChangeSnapshot(employee.insurance, afterPartial, insuranceKey)
      : afterPartial;

    const syntheticEvent: Event = {
      eventId: run.runId!,
      companyId: sessionStorage.getItem('companyId') ?? '',
      occurredDate: run.detectedDate as Timestamp,
      payload: {
        before: { ...employee, insurance: beforeInsurance ?? employee.insurance },
        after: { ...employee, insurance: afterInsurance },
      },
    };
    return this.buildInsuranceApprovalDraft(syntheticEvent);
  }

  async buildEmploymentChangeApprovalDraft(run: SystemCalculationRunItem): Promise<InsuranceApprovalDraft | null> {
    const beforeInsurance = this.extractInsurancePayload(run.payload?.['before']);
    const afterInsurance = this.extractInsurancePayload(run.payload?.['after']);
    if (!afterInsurance) return null;

    const beforeGrade = beforeInsurance?.currentGrade;
    const afterGrade = afterInsurance.currentGrade;
    let currentGrade = 0;
    let autoGrade = 0;
    if (beforeGrade !== undefined && afterGrade !== undefined) {
      currentGrade = beforeGrade;
      autoGrade = afterGrade;
    } else if (beforeGrade !== undefined) {
      currentGrade = beforeGrade;
      autoGrade = beforeGrade;
    } else if (afterGrade !== undefined) {
      currentGrade = 0;
      autoGrade = afterGrade;
    }

    return {
      currentGrade,
      autoGrade,
      approvedGrade: autoGrade,
      currentHealthStatus: this.getActualStatus(beforeInsurance?.healthInsurance),
      currentNursingStatus: this.getActualStatus(beforeInsurance?.nursingCareInsurance),
      currentPensionStatus: this.getActualStatus(beforeInsurance?.employeePensionInsurance),
      healthStatus: this.getActualStatus(afterInsurance.healthInsurance),
      nursingStatus: this.getActualStatus(afterInsurance.nursingCareInsurance),
      pensionStatus: this.getActualStatus(afterInsurance.employeePensionInsurance),
      healthAcquiredDate: this.formatDateInput(afterInsurance.healthInsurance?.acquiredDate?.toDate()),
      healthLostDate: this.formatDateInput(afterInsurance.healthInsurance?.lostDate?.toDate()),
      nursingAcquiredDate: this.formatDateInput(afterInsurance.nursingCareInsurance?.acquiredDate?.toDate()),
      nursingLostDate: this.formatDateInput(afterInsurance.nursingCareInsurance?.lostDate?.toDate()),
      pensionAcquiredDate: this.formatDateInput(afterInsurance.employeePensionInsurance?.acquiredDate?.toDate()),
      pensionLostDate: this.formatDateInput(afterInsurance.employeePensionInsurance?.lostDate?.toDate()),
    };
  }

  getInsuranceChangeLabel(run: SystemCalculationRunItem): string {
    if (isEmploymentChangeSystemRun(run)) {
      return this.formatInsuranceKeysLabel(String(run.payload?.['insuranceKey'] ?? ''));
    }
    if (run.type === '随時改定' || run.type === '算定基礎') return '等級';
    if (run.type === 'イベント') {
      const key = String(run.payload?.['insuranceKey'] ?? '');
      const label = this.formatInsuranceKeysLabel(key);
      if (label) return label;
      return String(run.payload?.['qualificationType'] ?? run.eventType ?? '—');
    }
    const key = String(run.payload?.['insuranceKey'] ?? '');
    return this.formatInsuranceKeysLabel(key) || (run.type === '資格喪失' ? '資格喪失' : '資格取得');
  }

  getInsuranceChangeReasonLabel(run: SystemCalculationRunItem): string {
    const source = String(run.payload?.['source'] ?? '');
    if (source === '一定年齢到達') {
      const reachAgeType = run.payload?.['reachAgeType'];
      return reachAgeType ? `一定年齢到達（${reachAgeType}）` : '一定年齢到達';
    }
    if (source === '雇用形態変更') return '雇用形態変更';
    if (source === '保険情報変更') return '保険情報変更';
    if (source === '入社') return '入社';
    if (source === '退社') return '退社';
    return source || '—';
  }

  getInsuranceChangeTypeLabel(run: SystemCalculationRunItem): string {
    if (run.type === '随時改定') return '随時改定';
    if (run.type === '算定基礎') return '算定基礎';
    if (run.type === 'その他' && run.runId?.startsWith('等級変更_')) return '等級変更';
    if (isEmploymentChangeSystemRun(run)) {
      if (run.type === '資格喪失') return '資格喪失';
      if (run.type === '資格取得') return '資格取得';
      return this.inferEmploymentQualificationType(run);
    }
    if (run.type === '資格喪失' || run.payload?.['qualificationType'] === '資格喪失') return '資格喪失';
    if (run.type === '資格取得' || run.payload?.['qualificationType'] === '資格取得') return '資格取得';
    return run.type ?? '—';
  }

  private inferEmploymentQualificationType(run: SystemCalculationRunItem): '資格取得' | '資格喪失' {
    const before = this.extractInsurancePayload(run.payload?.['before']);
    const after = this.extractInsurancePayload(run.payload?.['after']);
    const keys = ['healthInsurance', 'nursingCareInsurance', 'employeePensionInsurance'] as const;
    const hasLoss = keys.some(key => before?.[key]?.joined === true && after?.[key]?.joined !== true);
    return hasLoss ? '資格喪失' : '資格取得';
  }

  getInsuranceChangeDetectedDate(run: SystemCalculationRunItem): Timestamp | null | undefined {
    if (run.detectedDate) return run.detectedDate as Timestamp;

    const after = this.extractInsurancePayload(run.payload?.['after']);
    if (!after) return undefined;

    const keys = String(run.payload?.['insuranceKey'] ?? '')
      .split(',')
      .map(key => key.trim())
      .filter(Boolean) as InsuranceChangeKey[];

    const targetKeys: InsuranceChangeKey[] = keys.length > 0
      ? keys
      : ['healthInsurance', 'nursingCareInsurance', 'employeePensionInsurance'];

    const isLoss = run.type === '資格喪失' || run.payload?.['qualificationType'] === '資格喪失';
    for (const key of targetKeys) {
      const detail = after[key];
      const date = isLoss ? detail?.lostDate : detail?.acquiredDate;
      if (date) return date;
    }
    return undefined;
  }

  getInsuranceChangeDetailItems(
    run: SystemCalculationRunItem,
    draft: InsuranceApprovalDraft,
  ): InsuranceChangeDetailItem[] {
    const insuranceKeyRaw = String(run.payload?.['insuranceKey'] ?? '');
    const keys = insuranceKeyRaw
      ? insuranceKeyRaw.split(',').map(key => key.trim()).filter(Boolean)
      : ['healthInsurance', 'nursingCareInsurance', 'employeePensionInsurance'];

    const config: Record<InsuranceChangeKey, {
      name: string;
      status: keyof InsuranceApprovalDraft;
      acquired: keyof InsuranceApprovalDraft;
      lost: keyof InsuranceApprovalDraft;
    }> = {
      healthInsurance: {
        name: '健康保険',
        status: 'healthStatus',
        acquired: 'healthAcquiredDate',
        lost: 'healthLostDate',
      },
      nursingCareInsurance: {
        name: '介護保険',
        status: 'nursingStatus',
        acquired: 'nursingAcquiredDate',
        lost: 'nursingLostDate',
      },
      employeePensionInsurance: {
        name: '厚生年金',
        status: 'pensionStatus',
        acquired: 'pensionAcquiredDate',
        lost: 'pensionLostDate',
      },
    };

    return keys
      .map(key => {
        const entry = config[key as InsuranceChangeKey];
        if (!entry) return null;
        const status = draft[entry.status] as InsuranceStatusKind;
        const changeTypeLabel = status === 'joined' ? '加入' : status === 'lost' ? '喪失' : '未加入';
        const dateLabel = status === 'joined' ? '加入日' : status === 'lost' ? '喪失日' : '—';
        const dateValue = status === 'joined'
          ? String(draft[entry.acquired] || '—')
          : status === 'lost'
            ? String(draft[entry.lost] || '—')
            : '—';
        return {
          insuranceName: entry.name,
          changeTypeLabel,
          dateLabel,
          dateValue,
        };
      })
      .filter((item): item is InsuranceChangeDetailItem => item !== null);
  }

  async approveEmploymentChangeRun(
    run: SystemCalculationRunItem,
    draft: InsuranceApprovalDraft,
    loginEmployeeId: string,
  ): Promise<boolean> {
    const validationError = this.validateInsuranceApprovalDraft(draft);
    if (validationError) return false;

    const employee = await this.employeeService.getEmployeeByEmployeeId(run.employeeId);
    if (!employee) return false;

    const insurance: EmployeeInsurance = {
      currentGrade: this.resolveApprovedGrade(draft.healthStatus, draft.currentGrade, draft.autoGrade),
      healthInsurance: this.buildInsuranceDetailFromDraft(
        draft.healthStatus,
        draft.healthAcquiredDate,
        draft.healthLostDate,
        employee.insurance?.healthInsurance,
      ),
      nursingCareInsurance: this.buildInsuranceDetailFromDraft(
        draft.nursingStatus,
        draft.nursingAcquiredDate,
        draft.nursingLostDate,
        employee.insurance?.nursingCareInsurance,
        employee.insurance?.healthInsurance?.number,
      ),
      employeePensionInsurance: this.buildInsuranceDetailFromDraft(
        draft.pensionStatus,
        draft.pensionAcquiredDate,
        draft.pensionLostDate,
        employee.insurance?.employeePensionInsurance,
      ),
      basicPensionNumber: employee.insurance?.basicPensionNumber,
    };

    const updated = await this.employeeService.updateEmployeeInsurance(run.employeeId, insurance);
    if (!updated) return false;

    if (draft.healthStatus === 'lost') {
      const lossDate = draft.healthLostDate
        ? timestampFromDateInput(draft.healthLostDate)
        : (run.detectedDate as Timestamp);
      const dependentsHandled = await this.createSystemAppliedDependentRemovals(
        run.employeeId,
        lossDate,
        loginEmployeeId,
      );
      if (!dependentsHandled) return false;
    }

    return this.calculationRunService.markRunApplied(run.runId, loginEmployeeId)
      .then(async applied => {
        if (applied) {
          await this.enqueueAnnouncement(() => this.announcementLogicService.createFromEmploymentChangeRun(run));
        }
        return applied;
      });
  }

  async approveInsuranceChangeRun(
    run: SystemCalculationRunItem,
    draft: InsuranceApprovalDraft,
    loginEmployeeId: string,
  ): Promise<boolean> {
    const validationError = this.validateInsuranceApprovalDraft(draft);
    if (validationError) return false;

    const employee = await this.employeeService.getEmployeeByEmployeeId(run.employeeId);
    if (!employee) return false;

    const insuranceKey = String(run.payload?.['insuranceKey'] ?? '') as InsuranceChangeKey | '';
    const insurance: EmployeeInsurance = {
      currentGrade: employee.insurance?.currentGrade ?? 0,
      basicPensionNumber: employee.insurance?.basicPensionNumber,
      healthInsurance: employee.insurance?.healthInsurance ?? { joined: false },
      nursingCareInsurance: employee.insurance?.nursingCareInsurance ?? { joined: false },
      employeePensionInsurance: employee.insurance?.employeePensionInsurance ?? { joined: false },
    };

    if (insuranceKey === 'healthInsurance') {
      insurance.currentGrade = this.resolveApprovedGrade(draft.healthStatus, draft.currentGrade, draft.autoGrade);
      insurance.healthInsurance = this.buildInsuranceDetailFromDraft(
        draft.healthStatus,
        draft.healthAcquiredDate,
        draft.healthLostDate,
        employee.insurance?.healthInsurance,
      );
    } else if (insuranceKey === 'nursingCareInsurance') {
      insurance.nursingCareInsurance = this.buildInsuranceDetailFromDraft(
        draft.nursingStatus,
        draft.nursingAcquiredDate,
        draft.nursingLostDate,
        employee.insurance?.nursingCareInsurance,
        employee.insurance?.healthInsurance?.number,
      );
    } else if (insuranceKey === 'employeePensionInsurance') {
      insurance.employeePensionInsurance = this.buildInsuranceDetailFromDraft(
        draft.pensionStatus,
        draft.pensionAcquiredDate,
        draft.pensionLostDate,
        employee.insurance?.employeePensionInsurance,
      );
    } else {
      insurance.currentGrade = this.resolveApprovedGrade(draft.healthStatus, draft.currentGrade, draft.autoGrade);
      insurance.healthInsurance = this.buildInsuranceDetailFromDraft(
        draft.healthStatus,
        draft.healthAcquiredDate,
        draft.healthLostDate,
        employee.insurance?.healthInsurance,
      );
      insurance.nursingCareInsurance = this.buildInsuranceDetailFromDraft(
        draft.nursingStatus,
        draft.nursingAcquiredDate,
        draft.nursingLostDate,
        employee.insurance?.nursingCareInsurance,
        employee.insurance?.healthInsurance?.number,
      );
      insurance.employeePensionInsurance = this.buildInsuranceDetailFromDraft(
        draft.pensionStatus,
        draft.pensionAcquiredDate,
        draft.pensionLostDate,
        employee.insurance?.employeePensionInsurance,
      );
    }

    const updated = await this.employeeService.updateEmployeeInsurance(run.employeeId, insurance);
    if (!updated) return false;

    if (insuranceKey === 'healthInsurance' && !insurance.healthInsurance?.joined) {
      const dependentsUpdated = await this.setAllDependentsNotDependent(run.employeeId);
      if (!dependentsUpdated) return false;
    } else if (!insuranceKey && !insurance.healthInsurance?.joined) {
      const dependentsUpdated = await this.setAllDependentsNotDependent(run.employeeId);
      if (!dependentsUpdated) return false;
    }

    return this.calculationRunService.markRunApproved(
      run.runId,
      loginEmployeeId,
      undefined,
      getCurrentAppliedFromMonth(),
    );
  }

  async buildInsuranceApprovalDraft(event: Event): Promise<InsuranceApprovalDraft | null> {
    const before = event.payload?.['before'] as Employee | undefined;
    const after = event.payload?.['after'] as Employee | undefined;
    if (!after) return null;

    const isSpecificApplicableOffice = await this.companyService.isSpecificApplicableOffice();
    const required = this.employeeLogicService.isInsuranceRequired(after, isSpecificApplicableOffice);
    const autoGrade = await this.employeeLogicService.getInsuranceGradeAtNewEntry(after);
    const currentGrade = before?.insurance?.currentGrade ?? after.insurance?.currentGrade ?? 0;
    const changeDate = this.formatDateInput(event.occurredDate?.toDate()) || this.formatDateInput(new Date());

    const healthStatus = this.resolveAutoStatus(required.isHealthInsuranceRequired, before?.insurance?.healthInsurance);
    const nursingStatus = this.resolveAutoStatus(required.isNursingCareInsuranceRequired, before?.insurance?.nursingCareInsurance);
    const pensionStatus = this.resolveAutoStatus(required.isPensionInsuranceRequired, before?.insurance?.employeePensionInsurance);

    return {
      currentGrade,
      autoGrade: autoGrade ?? null,
      approvedGrade: this.resolveApprovedGrade(healthStatus, currentGrade, autoGrade),
      currentHealthStatus: this.getActualStatus(before?.insurance?.healthInsurance),
      currentNursingStatus: this.getActualStatus(before?.insurance?.nursingCareInsurance),
      currentPensionStatus: this.getActualStatus(before?.insurance?.employeePensionInsurance),
      healthStatus,
      nursingStatus,
      pensionStatus,
      healthAcquiredDate: this.resolveDraftAcquiredDate(healthStatus, changeDate),
      healthLostDate: this.resolveDraftLostDate(healthStatus, changeDate),
      nursingAcquiredDate: this.resolveDraftAcquiredDate(nursingStatus, changeDate),
      nursingLostDate: this.resolveDraftLostDate(nursingStatus, changeDate),
      pensionAcquiredDate: this.resolveDraftAcquiredDate(pensionStatus, changeDate),
      pensionLostDate: this.resolveDraftLostDate(pensionStatus, changeDate),
    };
  }

  validateInsuranceApprovalDraft(draft: InsuranceApprovalDraft): string | null {
    draft.approvedGrade = this.resolveApprovedGrade(draft.healthStatus, draft.currentGrade, draft.autoGrade);

    const checks = [
      { label: '健康保険', status: draft.healthStatus, acquiredDate: draft.healthAcquiredDate, lostDate: draft.healthLostDate },
      { label: '介護保険', status: draft.nursingStatus, acquiredDate: draft.nursingAcquiredDate, lostDate: draft.nursingLostDate },
      { label: '厚生年金', status: draft.pensionStatus, acquiredDate: draft.pensionAcquiredDate, lostDate: draft.pensionLostDate },
    ];

    for (const check of checks) {
      if (check.status === 'joined' && !check.acquiredDate) {
        return `${check.label}は加入の場合、取得日が必須です`;
      }
      if (check.status === 'lost' && !check.lostDate) {
        return `${check.label}は喪失の場合、喪失日が必須です`;
      }
      if (check.acquiredDate && check.lostDate && new Date(check.acquiredDate) > new Date(check.lostDate)) {
        return `${check.label}の取得日は喪失日以前にしてください`;
      }
    }

    if (draft.healthStatus === 'notJoined' && draft.approvedGrade !== 0) {
      return '健康保険が未加入の場合、等級は0にしてください';
    }

    const joinedGradeError = this.insuranceFormService.validateGradeForHealthJoined(
      draft.healthStatus,
      draft.approvedGrade,
    );
    if (joinedGradeError) return joinedGradeError;

    if (draft.approvedGrade < 0 || draft.approvedGrade > 50) {
      return '等級は0〜50の範囲で入力してください';
    }

    return null;
  }

  onInsuranceDraftStatusChange(draft: InsuranceApprovalDraft, insuranceKey: 'health' | 'nursing' | 'pension', changeDate: string) {
    if (insuranceKey === 'health') {
      this.applyInsuranceDraftStatusChange(draft, 'healthStatus', 'healthAcquiredDate', 'healthLostDate', changeDate);
      draft.approvedGrade = this.resolveApprovedGrade(draft.healthStatus, draft.currentGrade, draft.autoGrade);
      return;
    }
    if (insuranceKey === 'nursing') {
      this.applyInsuranceDraftStatusChange(draft, 'nursingStatus', 'nursingAcquiredDate', 'nursingLostDate', changeDate);
      return;
    }
    this.applyInsuranceDraftStatusChange(draft, 'pensionStatus', 'pensionAcquiredDate', 'pensionLostDate', changeDate);
  }

  private applyInsuranceDraftStatusChange(
    draft: InsuranceApprovalDraft,
    statusKey: 'healthStatus' | 'nursingStatus' | 'pensionStatus',
    acquiredKey: 'healthAcquiredDate' | 'nursingAcquiredDate' | 'pensionAcquiredDate',
    lostKey: 'healthLostDate' | 'nursingLostDate' | 'pensionLostDate',
    changeDate: string,
  ) {
    const status = draft[statusKey];
    if (status === 'joined') {
      draft[acquiredKey] = changeDate;
      draft[lostKey] = '';
      return;
    }
    if (status === 'lost') {
      draft[acquiredKey] = changeDate;
      draft[lostKey] = changeDate;
      return;
    }
    draft[acquiredKey] = '';
    draft[lostKey] = '';
  }

  async approveFixedSalaryEvent(
    employeeId: string,
    event: Event,
    draft: FixedSalaryApprovalDraft,
    loginEmployeeId: string,
    runId?: string,
  ): Promise<boolean> {
    const revisionSummary = {
      currentGrade: draft.currentGrade,
      approvedGrade: draft.approvedGrade,
      averageSalary: draft.averageSalary,
      targetPayrolls: draft.targetPayrolls ?? [],
    };
    if (runId) {
      const approved = await this.calculationRunService.markRunApproved(runId, loginEmployeeId, { revisionSummary });
      if (approved) {
        const run = await this.calculationRunService.getSystemCalculationRunById(runId);
        if (run) {
          await this.enqueueAnnouncement(() => this.announcementLogicService.createFromFixedSalaryRun(run));
        }
      }
      return approved;
    }
    return this.markEventApproved(employeeId, event, loginEmployeeId);
  }

  async rejectFixedSalaryRun(
    runId: string,
    draft: FixedSalaryApprovalDraft | null,
    loginEmployeeId: string,
  ): Promise<boolean> {
    const payloadExtension = draft ? {
      revisionSummary: {
        currentGrade: draft.currentGrade,
        approvedGrade: draft.approvedGrade,
        averageSalary: draft.averageSalary,
        targetPayrolls: draft.targetPayrolls ?? [],
        rejected: true,
      },
    } : undefined;
    return this.calculationRunService.markRunRejected(runId, loginEmployeeId, payloadExtension);
  }

  /** 承認済み随時改定を選択適用 */
  async applySelectedAdHocRevisions(
    runIds: string[],
    loginEmployeeId: string,
  ): Promise<{ appliedCount: number }> {
    if (runIds.length === 0) return { appliedCount: 0 };

    const allApplicable = await this.calculationRunService.getApplicableApprovedAdHocRevisionRuns();
    const applicableMap = new Map(allApplicable.map(run => [run.runId, run]));
    let appliedCount = 0;

    for (const runId of runIds) {
      const run = applicableMap.get(runId);
      if (!run) continue;

      const approvedGrade = await this.resolveApprovedGradeFromRun(run);
      if (approvedGrade === null) continue;

      const employee = await this.employeeService.getEmployeeByEmployeeId(run.employeeId);
      if (!employee) continue;

      const updated = await this.employeeService.updateEmployee({
        employeeId: run.employeeId,
        insurance: {
          ...employee.insurance,
          currentGrade: approvedGrade,
        } as EmployeeInsurance,
      });
      if (!updated) continue;

      const ok = await this.calculationRunService.markRunApplied(run.runId, loginEmployeeId);
      if (ok) appliedCount++;
    }

    return { appliedCount };
  }

  /** 承認済み随時改定を従業員等級へ反映し、計算結果を適用済みに更新 */
  async applyApprovedAdHocRevisions(
    loginEmployeeId: string,
    employeeId?: string,
  ): Promise<{ appliedCount: number }> {
    const runs = await this.calculationRunService.getApplicableApprovedAdHocRevisionRuns(employeeId);
    if (runs.length === 0) return { appliedCount: 0 };

    const byEmployee = new Map<string, SystemCalculationRunItem[]>();
    for (const run of runs) {
      const list = byEmployee.get(run.employeeId) ?? [];
      list.push(run);
      byEmployee.set(run.employeeId, list);
    }

    let appliedCount = 0;
    for (const [empId, empRuns] of byEmployee) {
      const latestRun = empRuns[empRuns.length - 1];
      const approvedGrade = await this.resolveApprovedGradeFromRun(latestRun);
      if (approvedGrade === null) continue;

      const employee = await this.employeeService.getEmployeeByEmployeeId(empId);
      if (!employee) continue;

      const updated = await this.employeeService.updateEmployee({
        employeeId: empId,
        insurance: {
          ...employee.insurance,
          currentGrade: approvedGrade,
        } as EmployeeInsurance,
      });
      if (!updated) continue;

      for (const run of empRuns) {
        const ok = await this.calculationRunService.markRunApplied(run.runId, loginEmployeeId);
        if (ok) appliedCount++;
      }
    }

    return { appliedCount };
  }

  private async resolveApprovedGradeFromRun(run: SystemCalculationRunItem): Promise<number | null> {
    const summary = run.payload?.['revisionSummary'] as { approvedGrade?: number } | undefined;
    if (summary?.approvedGrade !== undefined) return Number(summary.approvedGrade);

    const draft = await this.buildFixedSalaryApprovalDraft(this.buildEventViewFromRun(run));
    return draft?.approvedGrade ?? null;
  }

  async approveInsuranceEvent(
    employeeId: string,
    event: Event,
    draft: InsuranceApprovalDraft,
    loginEmployeeId: string,
    runId?: string,
  ): Promise<boolean> {
    const validationError = this.validateInsuranceApprovalDraft(draft);
    if (validationError) return false;

    const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    if (!employee) return false;

    const insurance: EmployeeInsurance = {
      currentGrade: this.resolveApprovedGrade(draft.healthStatus, draft.currentGrade, draft.autoGrade),
      healthInsurance: this.buildInsuranceDetailFromDraft(
        draft.healthStatus,
        draft.healthAcquiredDate,
        draft.healthLostDate,
        employee.insurance?.healthInsurance,
      ),
      nursingCareInsurance: this.buildInsuranceDetailFromDraft(
        draft.nursingStatus,
        draft.nursingAcquiredDate,
        draft.nursingLostDate,
        employee.insurance?.nursingCareInsurance,
        employee.insurance?.healthInsurance?.number,
      ),
      employeePensionInsurance: this.buildInsuranceDetailFromDraft(
        draft.pensionStatus,
        draft.pensionAcquiredDate,
        draft.pensionLostDate,
        employee.insurance?.employeePensionInsurance,
      ),
    };

    const employeeUpdated = await this.employeeService.updateEmployeeInsurance(employeeId, insurance);
    if (!employeeUpdated) return false;

    if (draft.healthStatus === 'lost' || draft.healthStatus === 'notJoined') {
      const dependentsUpdated = await this.setAllDependentsNotDependent(employeeId);
      if (!dependentsUpdated) return false;
    }

    return runId
      ? this.calculationRunService.markRunApplied(runId, loginEmployeeId)
      : this.markEventApplied(employeeId, event, loginEmployeeId);
  }

  async buildHireInsuranceApprovalDraft(run: SystemCalculationRunItem): Promise<HireInsuranceApprovalDraft | null> {
    const detail = await this.buildHireInsuranceDetailView(run);
    if (!detail) return null;

    const employee = await this.employeeService.getEmployeeByEmployeeId(run.employeeId);
    const isSpecificApplicableOffice = await this.companyService.isSpecificApplicableOffice();
    const autoGrade = employee
      ? await this.employeeLogicService.getInsuranceGradeAtNewEntry(employee)
      : null;

    const hireDate = this.formatDateInput((run.payload?.['occurredDate'] as Timestamp | undefined)?.toDate())
      || this.formatDateInput(new Date());

    const dependentEventIds = run.payload?.['dependentEventIds'] as string[] | undefined ?? [];
    const dependents: HireDependentApprovalDraft[] = [];
    for (let index = 0; index < dependentEventIds.length; index++) {
      const eventId = dependentEventIds[index];
      const event = await this.eventService.getEventById(run.employeeId, eventId);
      const after = event?.payload?.['after'] as Partial<Dependent> | undefined;
      if (!after) continue;
      const disabilityStudentDefaults = getDependentDisabilityStudentFormDefaults(after);
      dependents.push({
        eventId,
        dependentId: after.dependentId ?? `${index + 1}`,
        name: after.name ?? '',
        birthDate: this.formatDateInput(after.birthDate?.toDate()) || '',
        relationship: (after.relationship ?? '') as Relationship | '',
        dependentStartDate: this.formatDateInput(after.dependentStartDate?.toDate()) || hireDate,
        cohabitationType: after.cohabitationType ?? '',
        annualIncome: after.annualIncome ?? '',
        occupation: after.occupation ?? '',
        disabilityStatus: disabilityStudentDefaults.disabilityStatus,
        disabilityType: disabilityStudentDefaults.disabilityType,
        studentStatus: disabilityStudentDefaults.studentStatus,
        studentType: disabilityStudentDefaults.studentType,
      });
    }

    const healthJoined = detail.healthInsurance.joined === true;
    const resolvedGrade = healthJoined ? (autoGrade ?? detail.currentGrade ?? 0) : 0;

    return {
      currentGrade: resolvedGrade,
      autoGrade: autoGrade ?? null,
      basicPensionNumber: detail.basicPensionNumber ?? '',
      healthJoined: detail.healthInsurance.joined === true,
      healthAcquiredDate: this.formatDateInput(detail.healthInsurance.acquiredDate?.toDate()) || hireDate,
      healthCompanyBurdenRate: detail.healthInsurance.companyBurdenRate ?? 50,
      nursingJoined: detail.nursingCareInsurance.joined === true,
      nursingAcquiredDate: this.formatDateInput(detail.nursingCareInsurance.acquiredDate?.toDate()) || hireDate,
      nursingCompanyBurdenRate: detail.nursingCareInsurance.companyBurdenRate ?? 50,
      pensionJoined: detail.employeePensionInsurance.joined === true,
      pensionAcquiredDate: this.formatDateInput(detail.employeePensionInsurance.acquiredDate?.toDate()) || hireDate,
      pensionCompanyBurdenRate: detail.employeePensionInsurance.companyBurdenRate ?? 50,
      dependents,
    };
  }

  validateHireInsuranceApprovalDraft(draft: HireInsuranceApprovalDraft): string | null {
    if (draft.healthJoined && !draft.healthAcquiredDate) {
      return '健康保険は加入の場合、取得日が必須です';
    }
    if (draft.nursingJoined && !draft.nursingAcquiredDate) {
      return '介護保険は加入の場合、取得日が必須です';
    }
    if (draft.pensionJoined && !draft.pensionAcquiredDate) {
      return '厚生年金は加入の場合、取得日が必須です';
    }
    if (!draft.healthJoined && draft.currentGrade !== 0) {
      return '健康保険が未加入の場合、等級は0にしてください';
    }
    if (draft.healthJoined && draft.currentGrade < 1) {
      return '健康保険が加入の場合、等級は1以上で入力してください';
    }
    if (draft.currentGrade < 0 || draft.currentGrade > 50) {
      return '等級は0〜50の範囲で入力してください';
    }
    for (const dependent of draft.dependents) {
      if (!dependent.name || !dependent.birthDate || !dependent.relationship || !dependent.dependentStartDate) {
        return '扶養情報の必須項目を入力してください';
      }
    }
    return null;
  }

  private buildInsuranceFromHireApprovalDraft(draft: HireInsuranceApprovalDraft): EmployeeInsurance {
    return {
      currentGrade: draft.currentGrade,
      ...(draft.basicPensionNumber.trim() ? { basicPensionNumber: draft.basicPensionNumber.trim() } : {}),
      healthInsurance: this.buildJoinedInsuranceDetail(
        draft.healthJoined,
        draft.healthAcquiredDate,
        draft.healthCompanyBurdenRate,
      ),
      nursingCareInsurance: this.buildJoinedInsuranceDetail(
        draft.nursingJoined,
        draft.nursingAcquiredDate,
        draft.nursingCompanyBurdenRate,
      ),
      employeePensionInsurance: this.buildJoinedInsuranceDetail(
        draft.pensionJoined,
        draft.pensionAcquiredDate,
        draft.pensionCompanyBurdenRate,
      ),
    };
  }

  private buildJoinedInsuranceDetail(joined: boolean, acquiredDate: string, companyBurdenRate: number): InsuranceDetail {
    if (!joined) return { joined: false };
    return {
      joined: true,
      acquiredDate: timestampFromDateInput(acquiredDate),
      companyBurdenRate,
    };
  }

  async buildHireInsuranceDetailView(run: SystemCalculationRunItem): Promise<HireInsuranceDetailView | null> {
    const insurance = run.payload?.['insurance'] as EmployeeInsurance | undefined;
    if (!insurance) return null;

    const dependents: Partial<Dependent>[] = [];
    const dependentEventIds = run.payload?.['dependentEventIds'] as string[] | undefined ?? [];
    for (const eventId of dependentEventIds) {
      const event = await this.eventService.getEventById(run.employeeId, eventId);
      const after = event?.payload?.['after'] as Partial<Dependent> | undefined;
      if (after) dependents.push(after);
    }

    return {
      currentGrade: insurance.currentGrade ?? 0,
      basicPensionNumber: insurance.basicPensionNumber,
      healthInsurance: insurance.healthInsurance ?? { joined: false },
      nursingCareInsurance: insurance.nursingCareInsurance ?? { joined: false },
      employeePensionInsurance: insurance.employeePensionInsurance ?? { joined: false },
      dependents,
    };
  }

  async approveHireQualificationRun(
    run: SystemCalculationRunItem,
    loginEmployeeId: string,
    draft?: HireInsuranceApprovalDraft,
  ): Promise<boolean> {
    const insurance = draft
      ? this.buildInsuranceFromHireApprovalDraft(draft)
      : run.payload?.['insurance'] as EmployeeInsurance | undefined;
    if (!insurance) return false;

    const employeeUpdated = await this.employeeService.updateEmployeeInsurance(run.employeeId, insurance);
    if (!employeeUpdated) return false;

    const dependentEventIds = run.payload?.['dependentEventIds'] as string[] | undefined ?? [];
    if (draft) {
      for (const dependentDraft of draft.dependents) {
        const event = await this.eventService.getEventById(run.employeeId, dependentDraft.eventId);
        if (!event) continue;
        const existingAfter = event.payload?.['after'] as Partial<Dependent> | undefined;
        const after: Partial<Dependent> = {
          ...existingAfter,
          dependentId: dependentDraft.dependentId,
          name: dependentDraft.name,
          birthDate: timestampFromDateInput(dependentDraft.birthDate),
          relationship: dependentDraft.relationship as Relationship,
          isDependent: true,
          dependentStartDate: timestampFromDateInput(dependentDraft.dependentStartDate),
          ...(dependentDraft.cohabitationType
            ? { cohabitationType: dependentDraft.cohabitationType as CohabitationType }
            : {}),
          ...(dependentDraft.annualIncome !== '' && dependentDraft.annualIncome != null
            ? { annualIncome: Number(dependentDraft.annualIncome) }
            : {}),
          ...(dependentDraft.occupation?.trim() ? { occupation: dependentDraft.occupation.trim() } : {}),
          ...mapDependentDisabilityStudentFromForm(dependentDraft as Record<string, unknown>),
        };
        const updated = await this.eventService.updateEvent(run.employeeId, dependentDraft.eventId, {
          payload: { ...event.payload, after },
        });
        if (!updated) return false;
      }
    }

    for (const eventId of dependentEventIds) {
      const event = await this.eventService.getEventById(run.employeeId, eventId);
      if (!event || event.lifeEventType !== '入社') continue;
      const approved = await this.approveEmployeeDependentChange(run.employeeId, event, loginEmployeeId);
      if (!approved) return false;
    }

    return this.calculationRunService.markRunApproved(run.runId, loginEmployeeId, draft ? { insurance } : undefined)
      .then(async approved => {
        if (approved) {
          await this.enqueueAnnouncement(() => this.announcementLogicService.createFromHireRun(run));
        }
        return approved;
      });
  }

  async rejectHireQualificationRun(
    run: SystemCalculationRunItem,
    loginEmployeeId: string,
  ): Promise<boolean> {
    const dependentEventIds = run.payload?.['dependentEventIds'] as string[] | undefined ?? [];
    for (const eventId of dependentEventIds) {
      const event = await this.eventService.getEventById(run.employeeId, eventId);
      if (!event) continue;
      const rejected = await this.rejectEvent(run.employeeId, event, loginEmployeeId);
      if (!rejected) return false;
    }

    return this.calculationRunService.markRunRejected(run.runId, loginEmployeeId);
  }

  async buildRetireInsuranceDetailView(run: SystemCalculationRunItem): Promise<RetireInsuranceDetailView | null> {
    const before = run.payload?.['before'] as Employee | undefined;
    const insurance = before?.insurance;
    if (!insurance) return null;

    const dependents: Partial<Dependent>[] = [];
    const dependentEventIds = run.payload?.['dependentEventIds'] as string[] | undefined ?? [];
    for (const eventId of dependentEventIds) {
      const event = await this.eventService.getEventById(run.employeeId, eventId);
      const after = event?.payload?.['after'] as Partial<Dependent> | undefined;
      if (after) dependents.push(after);
    }

    return {
      resignationDate: (run.payload?.['resignationDate'] as Timestamp | undefined)
        ?? (run.payload?.['occurredDate'] as Timestamp | undefined),
      qualificationLossDate: run.payload?.['occurredDate'] as Timestamp | undefined,
      currentGrade: insurance.currentGrade ?? 0,
      healthInsurance: insurance.healthInsurance ?? { joined: false },
      nursingCareInsurance: insurance.nursingCareInsurance ?? { joined: false },
      employeePensionInsurance: insurance.employeePensionInsurance ?? { joined: false },
      dependents,
    };
  }

  async approveRetireQualificationRun(
    run: SystemCalculationRunItem,
    loginEmployeeId: string,
  ): Promise<boolean> {
    const employee = await this.employeeService.getEmployeeByEmployeeId(run.employeeId);
    if (!employee) return false;

    const qualificationLossDate = run.payload?.['occurredDate'] as Timestamp | undefined;
    if (!qualificationLossDate) return false;

    const currentGrade = employee.insurance?.currentGrade ?? 0;
    const insurance: EmployeeInsurance = {
      currentGrade,
      healthInsurance: this.buildLostInsuranceDetail(employee.insurance?.healthInsurance, qualificationLossDate),
      nursingCareInsurance: this.buildLostInsuranceDetail(employee.insurance?.nursingCareInsurance, qualificationLossDate),
      employeePensionInsurance: this.buildLostInsuranceDetail(employee.insurance?.employeePensionInsurance, qualificationLossDate),
    };

    const employeeUpdated = await this.employeeService.updateEmployeeInsurance(run.employeeId, insurance);
    if (!employeeUpdated) return false;

    const dependentEventIds = run.payload?.['dependentEventIds'] as string[] | undefined ?? [];
    for (const eventId of dependentEventIds) {
      const event = await this.eventService.getEventById(run.employeeId, eventId);
      if (!event || event.lifeEventType !== '退社') continue;
      const approved = await this.approveEmployeeDependentChange(run.employeeId, event, loginEmployeeId);
      if (!approved) return false;
    }

    if (employee.workStatus === '退社済み') {
      const companyId = sessionStorage.getItem('companyId') ?? '';
      const linkedUser = companyId ? await this.userService.getUserByEmployeeId(companyId, run.employeeId) : null;
      if (linkedUser?.uid) {
        const userUpdated = await this.userService.updateUser({
          uid: linkedUser.uid,
          permission: '閲覧',
        });
        if (!userUpdated) return false;
      }
    }

    return this.calculationRunService.markRunApproved(run.runId, loginEmployeeId)
      .then(async approved => {
        if (approved) {
          await this.enqueueAnnouncement(() => this.announcementLogicService.createFromRetireRun(run));
        }
        return approved;
      });
  }

  async rejectRetireQualificationRun(
    run: SystemCalculationRunItem,
    loginEmployeeId: string,
  ): Promise<boolean> {
    const dependentEventIds = run.payload?.['dependentEventIds'] as string[] | undefined ?? [];
    for (const eventId of dependentEventIds) {
      const event = await this.eventService.getEventById(run.employeeId, eventId);
      if (!event) continue;
      const rejected = await this.rejectEvent(run.employeeId, event, loginEmployeeId);
      if (!rejected) return false;
    }

    return this.calculationRunService.markRunRejected(run.runId, loginEmployeeId);
  }

  async approveRetireEvent(employeeId: string, event: Event, loginEmployeeId: string, runId?: string): Promise<boolean> {
    const after = event.payload?.['after'] as Employee | undefined;
    const isScheduledRetireApproval =
      event.applicantType === '管理者'
      && event.approval?.approvalStatus === '申請中'
      && event.eventType === '退社'
      && after?.workStatus === '退社予定';

    if (isScheduledRetireApproval) {
      return this.approveScheduledRetireEvent(employeeId, event, loginEmployeeId);
    }

    const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    if (!employee) return false;

    const resignationDate = after?.resignationDate ?? event.occurredDate;
    if (!resignationDate) return false;

    const qualificationLossDate = getQualificationLossTimestamp(resignationDate);
    const currentGrade = employee.insurance?.currentGrade ?? 0;
    const updated: Partial<Employee> = {
      employeeId,
      workStatus: '退社済み',
      resignationDate,
      insurance: {
        currentGrade,
        healthInsurance: this.buildLostInsuranceDetail(employee.insurance?.healthInsurance, qualificationLossDate),
        nursingCareInsurance: this.buildLostInsuranceDetail(employee.insurance?.nursingCareInsurance, qualificationLossDate),
        employeePensionInsurance: this.buildLostInsuranceDetail(employee.insurance?.employeePensionInsurance, qualificationLossDate),
      },
    };

    const employeeUpdated = await this.employeeService.updateEmployee(updated);
    if (!employeeUpdated) return false;

    const dependents = await this.dependentService.getDependents(employeeId);
    const activeDependents = dependents.filter(dependent => dependent.isDependent !== false);
    if (activeDependents.length > 0) {
      const dependentUpdated = await this.dependentService.updateDependents(
        employeeId,
        activeDependents.map(dependent => ({
          dependentId: dependent.dependentId,
          isDependent: false,
          dependentEndDate: qualificationLossDate,
        })),
      );
      if (!dependentUpdated) return false;
    }

    const companyId = sessionStorage.getItem('companyId') ?? '';
    const linkedUser = companyId ? await this.userService.getUserByEmployeeId(companyId, employeeId) : null;
    if (linkedUser?.uid) {
      const userUpdated = await this.userService.updateUser({
        uid: linkedUser.uid,
        permission: '閲覧',
      });
      if (!userUpdated) return false;
    }

    return runId
      ? this.calculationRunService.markRunApproved(runId, loginEmployeeId)
      : this.markEventApproved(employeeId, event, loginEmployeeId);
  }

  private async approveScheduledRetireEvent(
    employeeId: string,
    event: Event,
    loginEmployeeId: string,
  ): Promise<boolean> {
    const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    if (!employee?.resignationDate) return false;

    const resignationDate = employee.resignationDate;
    const previousEmployee: Employee = {
      ...employee,
      employmentContract: employee.employmentContract ? { ...employee.employmentContract } : undefined,
    };

    const employeeUpdated = await this.employeeService.updateEmployee({
      employeeId,
      workStatus: '退社済み',
      resignationDate,
    });
    if (!employeeUpdated) return false;

    await this.companyService.getCompany();
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
    const resignMonth = getWorkMonthForDate(resignationDate.toDate(), targetPeriodStart);
    const current = getWorkingYearMonth();
    const beforePeriod = resignMonth.year * 12 + resignMonth.month < current.year * 12 + current.month;

    if (!beforePeriod) {
      await this.employeeDetailEventService.createRetireInsuranceAndDependentEvents(
        employeeId,
        previousEmployee,
        resignationDate,
      );
    }

    return this.markEventApproved(employeeId, event, loginEmployeeId);
  }

  async rejectSystemRun(runId: string, loginEmployeeId: string): Promise<boolean> {
    return this.calculationRunService.markRunRejected(runId, loginEmployeeId);
  }

  buildEventViewFromRun(run: SystemCalculationRunItem): Event {
    return this.calculationRunService.toEventView(run);
  }

  async approveReachAgeEvent(employeeId: string, event: Event, loginEmployeeId: string): Promise<boolean> {
    const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    if (!employee) return false;

    const birthDate = employee.birthDate?.toDate();
    if (!birthDate) return false;

    const occurredDate = event.occurredDate?.toDate() ?? new Date();
    const birthdayThisYear = new Date(occurredDate.getFullYear(), birthDate.getMonth(), birthDate.getDate(), 0, 0, 0);
    const changeDate = Timestamp.fromDate(birthdayThisYear);
    const beforeInsurance = employee.insurance;

    let afterInsurance: EmployeeInsurance;
    let shouldClearDependents = false;
    switch (event.reachAgeType) {
      case '40歳': {
        const healthNumber = employee.insurance?.healthInsurance?.number;
        afterInsurance = {
          ...employee.insurance,
          currentGrade: employee.insurance?.currentGrade ?? 0,
          nursingCareInsurance: {
            joined: true,
            acquiredDate: changeDate,
            ...(healthNumber ? { number: healthNumber } : {}),
            companyBurdenRate: employee.insurance?.nursingCareInsurance?.companyBurdenRate
              ?? employee.insurance?.healthInsurance?.companyBurdenRate
              ?? 50,
          },
        };
        break;
      }
      case '65歳':
        afterInsurance = {
          ...employee.insurance,
          currentGrade: employee.insurance?.currentGrade ?? 0,
          nursingCareInsurance: {
            ...employee.insurance?.nursingCareInsurance,
            joined: false,
            lostDate: changeDate,
          },
        };
        break;
      case '70歳':
        afterInsurance = {
          ...employee.insurance,
          currentGrade: employee.insurance?.currentGrade ?? 0,
          employeePensionInsurance: {
            ...employee.insurance?.employeePensionInsurance,
            joined: false,
            lostDate: changeDate,
          },
        };
        break;
      case '75歳':
        shouldClearDependents = true;
        afterInsurance = {
          currentGrade: employee.insurance?.currentGrade ?? 0,
          healthInsurance: this.buildLostInsuranceDetail(employee.insurance?.healthInsurance, changeDate),
          nursingCareInsurance: this.buildLostInsuranceDetail(employee.insurance?.nursingCareInsurance, changeDate),
          employeePensionInsurance: this.buildLostInsuranceDetail(employee.insurance?.employeePensionInsurance, changeDate),
        };
        break;
      default:
        return false;
    }

    const runResult = await this.employeeDetailEventService.createReachAgeInsuranceChangeRuns(
      employeeId,
      beforeInsurance,
      afterInsurance,
      loginEmployeeId,
      event.eventId,
      event.reachAgeType,
    );
    if (!runResult.success) return false;

    const employeeUpdated = await this.employeeService.updateEmployee({ employeeId, insurance: afterInsurance });
    if (!employeeUpdated) return false;

    if (shouldClearDependents) {
      const dependentsUpdated = await this.setAllDependentsNotDependent(employeeId);
      if (!dependentsUpdated) return false;
    }

    return this.markEventApproved(employeeId, event, loginEmployeeId);
  }

  async approveSimpleEvent(employeeId: string, event: Event, loginEmployeeId: string): Promise<boolean> {
    if (event.eventType === '固定給変更' && event.applicantType === '管理者') {
      return this.approveAdminFixedSalaryEvent(employeeId, event, loginEmployeeId);
    }
    if (event.eventType === '雇用形態変更' && event.applicantType === '管理者') {
      return this.approveAdminEmploymentChangeEvent(employeeId, event, loginEmployeeId);
    }
    if (event.eventType === '勤務状況変更' && event.applicantType === '管理者') {
      return this.approveAdminWorkStatusEvent(employeeId, event, loginEmployeeId);
    }
    if (event.eventType === '扶養情報変更') {
      return this.approveAdminDependentChangeEvent(employeeId, event, loginEmployeeId);
    }
    return this.markEventApproved(employeeId, event, loginEmployeeId);
  }

  async approveAdminDependentChangeEvent(employeeId: string, event: Event, loginEmployeeId: string): Promise<boolean> {
    const afterRecord = event.payload?.['after'] as { dependents?: Dependent[] } | Dependent | undefined;
    if (afterRecord && 'dependentId' in afterRecord) {
      return this.approveEmployeeDependentChange(employeeId, event, loginEmployeeId);
    }

    const afterDependents = (afterRecord as { dependents?: Dependent[] } | undefined)?.dependents;
    if (!afterDependents) return false;

    for (const dependent of afterDependents) {
      const saved = await this.dependentService.updateDependent(employeeId, dependent);
      if (!saved) return false;
    }

    const applied = await this.markEventApplied(employeeId, event, loginEmployeeId);
    if (applied) {
      await this.enqueueAnnouncementAfterEventApplied(employeeId, event);
    }
    return applied;
  }

  async approveAdminFixedSalaryEvent(employeeId: string, event: Event, loginEmployeeId: string): Promise<boolean> {
    const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    if (!employee) return false;

    const afterSalary = event.payload?.['after'] as number | undefined;
    if (afterSalary === undefined) return false;

    const beforeEmployee: Employee = {
      ...employee,
      employmentContract: employee.employmentContract ? { ...employee.employmentContract } : undefined,
    };
    const afterEmployee: Employee = {
      ...employee,
      employmentContract: {
        ...employee.employmentContract,
        fixedSalary: afterSalary,
      },
    };

    const updated = await this.employeeService.updateEmployee({
      employeeId,
      employmentContract: afterEmployee.employmentContract,
    });
    if (!updated) return false;

    const occurredDate = event.occurredDate ?? Timestamp.now();
    await this.employeeDetailEventService.createAdHocRevisionOnApproval(
      employeeId,
      beforeEmployee,
      afterEmployee,
      occurredDate,
      loginEmployeeId,
    );

    return this.markEventApplied(employeeId, event, loginEmployeeId);
  }

  async approveAdminEmploymentChangeEvent(employeeId: string, event: Event, loginEmployeeId: string): Promise<boolean> {
    const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    if (!employee) return false;

    const afterContract = event.payload?.['after'] as Employee['employmentContract'] | undefined;
    if (!afterContract) return false;

    const beforeEmployee: Employee = {
      ...employee,
      employmentContract: employee.employmentContract ? { ...employee.employmentContract } : undefined,
    };
    const afterEmployee: Employee = {
      ...employee,
      employmentContract: { ...employee.employmentContract, ...afterContract },
    };

    const updated = await this.employeeService.updateEmployee({
      employeeId,
      employmentContract: afterEmployee.employmentContract,
    });
    if (!updated) return false;

    const occurredDate = event.occurredDate ?? Timestamp.now();
    await this.employeeDetailEventService.createEmploymentSystemRunOnApproval(
      employeeId,
      beforeEmployee,
      afterEmployee,
      occurredDate,
    );

    return this.markEventApplied(employeeId, event, loginEmployeeId);
  }

  async approveAdminWorkStatusEvent(employeeId: string, event: Event, loginEmployeeId: string): Promise<boolean> {
    const after = event.payload?.['after'] as Record<string, unknown> | undefined;
    if (!after) return false;

    const update: Partial<Employee> = { employeeId };

    if (event.changeType === '休職開始') {
      update.workStatus = '休職中';
      update.leaveTypes = after['leaveTypes'] as Employee['leaveTypes'];
      if (after['leaveStartDate']) update.leaveStartDate = after['leaveStartDate'] as Timestamp;
      if (after['leaveEndDate']) update.leaveEndDate = after['leaveEndDate'] as Timestamp;
    } else if (event.changeType === '休職終了') {
      update.workStatus = '通常勤務';
      update.leaveTypes = null;
      if (after['leaveEndDate']) update.leaveEndDate = after['leaveEndDate'] as Timestamp;
    } else {
      update.workStatus = after['workStatus'] as Employee['workStatus'];
      update.leaveTypes = after['leaveTypes'] as Employee['leaveTypes'];
    }

    const updated = await this.employeeService.updateEmployee(update);
    if (!updated) return false;
    const applied = await this.markEventApplied(employeeId, event, loginEmployeeId);
    if (applied) {
      await this.enqueueAnnouncementAfterEventApplied(employeeId, event);
    }
    return applied;
  }

  /** 従業員ライフイベント申請の承認（マスター未反映） */
  async approveEmployeeApplicationOnly(employeeId: string, event: Event, loginEmployeeId: string): Promise<boolean> {
    return this.markEventApproved(employeeId, event, loginEmployeeId);
  }

  /** 承認済み従業員申請をマスターへ適用 */
  async applyApprovedEmployeeApplicationEvent(employeeId: string, event: Event, loginEmployeeId: string): Promise<boolean> {
    if (event.approval?.approvalStatus !== '承認済み') return false;

    const applied = await this.applyEmployeeApplicationToMaster(employeeId, event);
    if (!applied) return false;

    const result = await this.markEventApplied(employeeId, event, loginEmployeeId);
    if (result) {
      await this.enqueueAnnouncementAfterEventApplied(employeeId, event);
    }
    return result;
  }

  /** @deprecated approveEmployeeApplicationOnly / applyApprovedEmployeeApplicationEvent を使用 */
  async approveEmployeeApplicationEvent(employeeId: string, event: Event, loginEmployeeId: string): Promise<boolean> {
    switch (event.eventType) {
      case '氏名変更':
        return this.approveEmployeeNameChange(employeeId, event, loginEmployeeId);
      case '扶養情報変更':
        return this.approveEmployeeDependentChange(employeeId, event, loginEmployeeId);
      case '雇用形態変更':
      case '勤務状況変更':
        return this.approveEmployeeWorkChange(employeeId, event, loginEmployeeId);
      default:
        return false;
    }
  }

  private async applyEmployeeApplicationToMaster(employeeId: string, event: Event): Promise<boolean> {
    switch (event.eventType) {
      case '氏名変更': {
        const afterName = String(event.payload?.['after'] ?? '');
        return this.employeeService.updateEmployee({ employeeId, firstName: afterName });
      }
      case '扶養情報変更':
        return this.applyEmployeeDependentChange(employeeId, event);
      case '雇用形態変更':
      case '勤務状況変更':
        return this.applyEmployeeWorkChange(employeeId, event);
      default:
        return false;
    }
  }

  private async applyEmployeeDependentChange(employeeId: string, event: Event): Promise<boolean> {
    const after = event.payload?.['after'] as Dependent | undefined;
    if (!after?.dependentId) return false;

    const dependent: Partial<Dependent> = {
      dependentId: after.dependentId,
      name: after.name,
      relationship: after.relationship as Relationship,
      birthDate: after.birthDate,
      isDependent: after.isDependent !== false,
      dependentStartDate: after.dependentStartDate,
      dependentEndDate: after.dependentEndDate,
      cohabitationType: after.cohabitationType,
      annualIncome: after.annualIncome,
      occupation: after.occupation,
      hasDisability: after.hasDisability,
      disabilityType: after.disabilityType,
      isStudent: after.isStudent,
      studentType: after.studentType,
    };

    const before = event.payload?.['before'] as Dependent | null | undefined;
    return before
      ? this.dependentService.updateDependent(employeeId, dependent)
      : this.dependentService.registerDependents(employeeId, [dependent]);
  }

  private async applyEmployeeWorkChange(employeeId: string, event: Event): Promise<boolean> {
    if (event.changeType === '休職開始' || event.changeType === '休職終了') {
      return this.applyAdminWorkStatusEvent(employeeId, event);
    }

    const after = event.payload?.['after'] as Employee | undefined;
    if (!after) return false;

    return this.employeeService.updateEmployee({
      employeeId,
      workStatus: after.workStatus,
      leaveTypes: after.leaveTypes,
      ...(after.leaveStartDate ? { leaveStartDate: after.leaveStartDate } : {}),
      ...(after.leaveEndDate ? { leaveEndDate: after.leaveEndDate } : {}),
    });
  }

  private async applyAdminWorkStatusEvent(employeeId: string, event: Event): Promise<boolean> {
    const after = event.payload?.['after'] as Record<string, unknown> | undefined;
    if (!after) return false;

    const update: Partial<Employee> = { employeeId };

    if (event.changeType === '休職開始') {
      update.workStatus = '休職中';
      update.leaveTypes = after['leaveTypes'] as Employee['leaveTypes'];
      if (after['leaveStartDate']) update.leaveStartDate = after['leaveStartDate'] as Timestamp;
      if (after['leaveEndDate']) update.leaveEndDate = after['leaveEndDate'] as Timestamp;
    } else if (event.changeType === '休職終了') {
      update.workStatus = '通常勤務';
      update.leaveTypes = null;
      if (after['leaveEndDate']) update.leaveEndDate = after['leaveEndDate'] as Timestamp;
    } else {
      update.workStatus = after['workStatus'] as Employee['workStatus'];
      update.leaveTypes = after['leaveTypes'] as Employee['leaveTypes'];
    }

    return this.employeeService.updateEmployee(update);
  }

  private async markEventApplied(employeeId: string, event: Event, loginEmployeeId: string): Promise<boolean> {
    event.approval = {
      approvalStatus: '適用済み',
      approvedDate: event.approval?.approvedDate ?? Timestamp.now(),
      approvedBy: event.approval?.approvedBy ?? loginEmployeeId,
      appliedFromMonth: getCurrentAppliedFromMonth(),
    };
    return this.eventService.updateEvent(employeeId, event.eventId, event);
  }

  private async approveEmployeeNameChange(employeeId: string, event: Event, loginEmployeeId: string): Promise<boolean> {
    const afterName = String(event.payload?.['after'] ?? '');
    const updated = await this.employeeService.updateEmployee({ employeeId, firstName: afterName });
    if (!updated) return false;
    return this.markEventApproved(employeeId, event, loginEmployeeId);
  }

  private async approveEmployeeWorkChange(employeeId: string, event: Event, loginEmployeeId: string): Promise<boolean> {
    if (event.changeType === '休職開始' || event.changeType === '休職終了') {
      return this.approveAdminWorkStatusEvent(employeeId, event, loginEmployeeId);
    }

    const after = event.payload?.['after'] as Employee | undefined;
    if (!after) return false;

    const updated = await this.employeeService.updateEmployee({
      employeeId,
      workStatus: after.workStatus,
      leaveTypes: after.leaveTypes,
      ...(after.leaveStartDate ? { leaveStartDate: after.leaveStartDate } : {}),
      ...(after.leaveEndDate ? { leaveEndDate: after.leaveEndDate } : {}),
    });
    if (!updated) return false;
    return this.markEventApproved(employeeId, event, loginEmployeeId);
  }

  private async approveEmployeeDependentChange(employeeId: string, event: Event, loginEmployeeId: string): Promise<boolean> {
    const after = event.payload?.['after'] as Dependent | undefined;
    if (!after?.dependentId) return false;

    const dependent: Partial<Dependent> = {
      dependentId: after.dependentId,
      name: after.name,
      relationship: after.relationship as Relationship,
      birthDate: after.birthDate,
      isDependent: after.isDependent !== false,
      dependentStartDate: after.dependentStartDate,
      dependentEndDate: after.dependentEndDate,
      cohabitationType: after.cohabitationType,
      annualIncome: after.annualIncome,
      occupation: after.occupation,
      hasDisability: after.hasDisability,
      disabilityType: after.disabilityType,
      isStudent: after.isStudent,
      studentType: after.studentType,
    };

    const before = event.payload?.['before'] as Dependent | null | undefined;
    const saved = before
      ? await this.dependentService.updateDependent(employeeId, dependent)
      : await this.dependentService.registerDependents(employeeId, [dependent]);

    if (!saved) return false;
    const applied = await this.markEventApplied(employeeId, event, loginEmployeeId);
    if (applied) {
      await this.enqueueAnnouncementAfterEventApplied(employeeId, event);
    }
    return applied;
  }

  async rejectEvent(employeeId: string, event: Event, loginEmployeeId: string): Promise<boolean> {
    event.approval = {
      approvalStatus: '却下',
      approvedDate: Timestamp.now(),
      approvedBy: loginEmployeeId,
    };
    return this.eventService.updateEvent(employeeId, event.eventId, event);
  }

  private getFixedSalaryChangeMonth(event: Event) {
    const changeDate = (event.payload?.['fixedSalaryChangeDate'] as Timestamp | undefined)?.toDate()
      ?? event.occurredDate?.toDate()
      ?? new Date();
    return { year: changeDate.getFullYear(), month: changeDate.getMonth() + 1 };
  }

  private buildLostInsuranceDetail(existing: InsuranceDetail | undefined, lostDate: Timestamp): InsuranceDetail {
    const detail: InsuranceDetail = { joined: false, lostDate };
    if (existing?.acquiredDate) {
      detail.acquiredDate = existing.acquiredDate;
    }
    if (existing?.number) {
      detail.number = existing.number;
    }
    if (existing?.companyBurdenRate !== undefined) {
      detail.companyBurdenRate = existing.companyBurdenRate;
    }
    return detail;
  }

  private async markEventApproved(employeeId: string, event: Event, loginEmployeeId: string): Promise<boolean> {
    event.approval = {
      approvalStatus: '承認済み',
      approvedDate: Timestamp.now(),
      approvedBy: loginEmployeeId,
    };
    return this.eventService.updateEvent(employeeId, event.eventId, event);
  }

  private resolveAutoStatus(required: boolean | undefined, currentDetail?: InsuranceDetail): InsuranceStatusKind {
    const current = this.getActualStatusForEligibility(currentDetail);
    if (!required) {
      if (current === 'joined') return 'lost';
      return current;
    }
    return 'joined';
  }

  private getActualStatusForEligibility(detail?: InsuranceDetail): InsuranceStatusKind {
    if (!detail) return 'notJoined';
    if (detail.joined) return 'joined';
    if (detail.lostDate) return 'lost';
    return 'notJoined';
  }

  private getActualStatus(detail?: InsuranceDetail): InsuranceStatusKind {
    if (!detail) return 'notJoined';
    if (detail.joined) return 'joined';
    if (detail.lostDate || detail.acquiredDate) return 'lost';
    return 'notJoined';
  }

  private async setAllDependentsNotDependent(employeeId: string): Promise<boolean> {
    const dependents = await this.dependentService.getDependents(employeeId);
    const activeDependents = dependents.filter(dependent => dependent.isDependent !== false);
    if (activeDependents.length === 0) return true;

    return this.dependentService.updateDependents(
      employeeId,
      activeDependents.map(dependent => ({
        dependentId: dependent.dependentId,
        isDependent: false,
      })),
    );
  }

  private async createSystemAppliedDependentRemovals(
    employeeId: string,
    lossDate: Timestamp,
    loginEmployeeId: string,
  ): Promise<boolean> {
    const dependents = await this.dependentService.getDependents(employeeId);
    const activeDependents = dependents.filter(dependent => dependent.isDependent !== false);
    if (activeDependents.length === 0) return true;

    const changes = activeDependents.map(dependent => ({
      before: dependent,
      after: {
        ...dependent,
        isDependent: false,
        dependentEndDate: lossDate,
      } as Partial<Dependent>,
    }));
    const inputs = this.dependentChangeEventService.buildChangeInputs(changes);
    const createdIds = await this.dependentChangeEventService.createAppliedDependentChangeEvents(
      employeeId,
      inputs,
      loginEmployeeId,
      { applicantType: 'システム' },
    );
    return createdIds.length === inputs.length;
  }

  private formatInsuranceKeysLabel(insuranceKey: string): string {
    if (!insuranceKey) return '';
    return insuranceKey
      .split(',')
      .map(key => {
        switch (key.trim()) {
          case 'healthInsurance': return '健康保険';
          case 'nursingCareInsurance': return '介護保険';
          case 'employeePensionInsurance': return '厚生年金';
          default: return key.trim();
        }
      })
      .filter(Boolean)
      .join('、');
  }

  private extractInsurancePayload(payload: unknown): EmployeeInsurance | undefined {
    if (!payload || typeof payload !== 'object') return undefined;
    const data = payload as Record<string, unknown>;
    if (data['insurance']) {
      return data['insurance'] as EmployeeInsurance;
    }
    if ('healthInsurance' in data || 'nursingCareInsurance' in data || 'employeePensionInsurance' in data || 'currentGrade' in data) {
      return data as EmployeeInsurance;
    }
    return undefined;
  }

  private mergeInsuranceChangeSnapshot(
    base: EmployeeInsurance | undefined,
    partial: EmployeeInsurance | undefined,
    changedKey: InsuranceChangeKey,
  ): EmployeeInsurance {
    const current: EmployeeInsurance = {
      currentGrade: base?.currentGrade ?? 0,
      basicPensionNumber: base?.basicPensionNumber,
      healthInsurance: base?.healthInsurance ?? { joined: false },
      nursingCareInsurance: base?.nursingCareInsurance ?? { joined: false },
      employeePensionInsurance: base?.employeePensionInsurance ?? { joined: false },
    };
    if (!partial) return current;

    return {
      ...current,
      currentGrade: partial.currentGrade ?? current.currentGrade ?? 0,
      healthInsurance: changedKey === 'healthInsurance'
        ? (partial.healthInsurance ?? current.healthInsurance ?? { joined: false })
        : (current.healthInsurance ?? { joined: false }),
      nursingCareInsurance: changedKey === 'nursingCareInsurance'
        ? (partial.nursingCareInsurance ?? current.nursingCareInsurance ?? { joined: false })
        : (current.nursingCareInsurance ?? { joined: false }),
      employeePensionInsurance: changedKey === 'employeePensionInsurance'
        ? (partial.employeePensionInsurance ?? current.employeePensionInsurance ?? { joined: false })
        : (current.employeePensionInsurance ?? { joined: false }),
    };
  }

  private resolveApprovedGrade(
    healthStatus: InsuranceStatusKind,
    currentGrade: number,
    autoGrade: number | null | undefined,
  ): number {
    if (healthStatus === 'notJoined') return 0;
    if (healthStatus === 'lost') return currentGrade;
    return autoGrade ?? currentGrade;
  }

  private resolveDraftAcquiredDate(status: InsuranceStatusKind, changeDate: string): string {
    if (status === 'joined' || status === 'lost') {
      return changeDate;
    }
    return '';
  }

  private resolveDraftLostDate(status: InsuranceStatusKind, changeDate: string): string {
    return status === 'lost' ? changeDate : '';
  }

  private buildInsuranceDetailFromDraft(
    status: InsuranceStatusKind,
    acquiredDate: string,
    lostDate: string,
    existing?: InsuranceDetail,
    sharedNumber?: string,
  ): InsuranceDetail {
    if (status === 'notJoined') {
      return { joined: false };
    }

    const detail: InsuranceDetail = {
      joined: status === 'joined',
      companyBurdenRate: existing?.companyBurdenRate ?? 50,
    };

    const number = existing?.number ?? (status === 'joined' ? sharedNumber : undefined);
    if (number) {
      detail.number = number;
    }

    if (status === 'joined' && acquiredDate) {
      detail.acquiredDate = timestampFromDateInput(acquiredDate);
    }

    if (status === 'lost') {
      detail.joined = false;
      if (existing?.acquiredDate) {
        detail.acquiredDate = existing.acquiredDate;
      } else if (acquiredDate) {
        detail.acquiredDate = timestampFromDateInput(acquiredDate);
      }
      if (lostDate) {
        detail.lostDate = timestampFromDateInput(lostDate);
      }
    }

    return detail;
  }

  private formatDateInput(date?: Date): string {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}