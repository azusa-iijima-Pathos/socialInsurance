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
import { Relationship } from '../../constants/model-constants';
import { CalculationRunService } from '../Firestore/calculation-run-service';
import { SystemCalculationRunItem } from '../Firestore/calculation-run-service';
import { UserService } from '../Firestore/user-service';

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
    const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    if (!employee) return false;

    const updated: Partial<Employee> = {
      employeeId,
      insurance: {
        ...employee.insurance,
        currentGrade: draft.approvedGrade,
      } as EmployeeInsurance,
    };

    const employeeUpdated = await this.employeeService.updateEmployee(updated);
    if (!employeeUpdated) return false;

    return runId
      ? this.calculationRunService.markRunApproved(runId, loginEmployeeId, {
        revisionSummary: {
          currentGrade: draft.currentGrade,
          approvedGrade: draft.approvedGrade,
          averageSalary: draft.averageSalary,
        },
      })
      : this.markEventApproved(employeeId, event, loginEmployeeId);
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
      ? this.calculationRunService.markRunApproved(runId, loginEmployeeId)
      : this.markEventApproved(employeeId, event, loginEmployeeId);
  }

  async approveRetireEvent(employeeId: string, event: Event, loginEmployeeId: string, runId?: string): Promise<boolean> {
    const after = event.payload?.['after'] as Employee | undefined;
    const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    if (!employee) return false;

    const resignationDate = after?.resignationDate ?? event.occurredDate;
    if (!resignationDate) return false;

    const currentGrade = employee.insurance?.currentGrade ?? 0;
    const updated: Partial<Employee> = {
      employeeId,
      workStatus: '退社済み',
      resignationDate,
      insurance: {
        currentGrade,
        healthInsurance: this.buildLostInsuranceDetail(employee.insurance?.healthInsurance, resignationDate),
        nursingCareInsurance: this.buildLostInsuranceDetail(employee.insurance?.nursingCareInsurance, resignationDate),
        employeePensionInsurance: this.buildLostInsuranceDetail(employee.insurance?.employeePensionInsurance, resignationDate),
      },
    };

    const employeeUpdated = await this.employeeService.updateEmployee(updated);
    if (!employeeUpdated) return false;

    const dependents = await this.dependentService.getDependents(employeeId);
    if (dependents.length > 0) {
      const dependentUpdated = await this.dependentService.updateDependents(
        employeeId,
        dependents.map(dependent => ({
          dependentId: dependent.dependentId,
          isDependent: false,
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

    let updateEmployee: Partial<Employee> = {};
    let shouldClearDependents = false;
    switch (event.reachAgeType) {
      case '40歳': {
        const healthNumber = employee.insurance?.healthInsurance?.number;
        updateEmployee = {
          employeeId,
          insurance: {
            ...employee.insurance,
            nursingCareInsurance: {
              joined: true,
              acquiredDate: changeDate,
              ...(healthNumber ? { number: healthNumber } : {}),
              companyBurdenRate: employee.insurance?.nursingCareInsurance?.companyBurdenRate
                ?? employee.insurance?.healthInsurance?.companyBurdenRate
                ?? 50,
            },
          },
        };
        break;
      }
      case '65歳':
        updateEmployee = {
          employeeId,
          insurance: {
            ...employee.insurance,
            nursingCareInsurance: {
              ...employee.insurance?.nursingCareInsurance,
              joined: false,
              lostDate: changeDate,
            },
          },
        };
        break;
      case '70歳':
        updateEmployee = {
          employeeId,
          insurance: {
            ...employee.insurance,
            employeePensionInsurance: {
              ...employee.insurance?.employeePensionInsurance,
              joined: false,
              lostDate: changeDate,
            },
          },
        };
        break;
      case '75歳':
        shouldClearDependents = true;
        updateEmployee = {
          employeeId,
          insurance: {
            currentGrade: employee.insurance?.currentGrade ?? 0,
            healthInsurance: this.buildLostInsuranceDetail(employee.insurance?.healthInsurance, changeDate),
            nursingCareInsurance: this.buildLostInsuranceDetail(employee.insurance?.nursingCareInsurance, changeDate),
            employeePensionInsurance: this.buildLostInsuranceDetail(employee.insurance?.employeePensionInsurance, changeDate),
          },
        };
        break;
      default:
        return false;
    }

    const employeeUpdated = await this.employeeService.updateEmployee(updateEmployee);
    if (!employeeUpdated) return false;

    if (shouldClearDependents) {
      const dependentsUpdated = await this.setAllDependentsNotDependent(employeeId);
      if (!dependentsUpdated) return false;
    }

    return this.markEventApproved(employeeId, event, loginEmployeeId);
  }

  async approveSimpleEvent(employeeId: string, event: Event, loginEmployeeId: string): Promise<boolean> {
    return this.markEventApproved(employeeId, event, loginEmployeeId);
  }

  /** 従業員ライフイベント申請の承認（内容を従業員情報へ反映） */
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

  private async approveEmployeeNameChange(employeeId: string, event: Event, loginEmployeeId: string): Promise<boolean> {
    const afterName = String(event.payload?.['after'] ?? '');
    const updated = await this.employeeService.updateEmployee({ employeeId, firstName: afterName });
    if (!updated) return false;
    return this.markEventApproved(employeeId, event, loginEmployeeId);
  }

  private async approveEmployeeWorkChange(employeeId: string, event: Event, loginEmployeeId: string): Promise<boolean> {
    const after = event.payload?.['after'] as Employee | undefined;
    if (!after) return false;

    const updated = await this.employeeService.updateEmployee({
      employeeId,
      workStatus: after.workStatus,
      leaveTypes: after.leaveTypes,
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
    return this.markEventApproved(employeeId, event, loginEmployeeId);
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