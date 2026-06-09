import { inject, Injectable } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
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
import { addMonths } from './event-id-service';

type InsuranceStatusKind = 'joined' | 'notJoined' | 'lost';

export type FixedSalaryApprovalDraft = {
  occurredDate: Timestamp;
  currentGrade: number;
  revisionLabel: string;
  approvedGrade: number;
  canRevise: boolean;
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
        revisionLabel: '判定不可のため等級変更なし',
        approvedGrade: currentGrade,
        canRevise: false,
      };
    }

    if (revision.status === '変更なし') {
      return {
        currentGrade,
        revisionLabel: '2等級以上の変更なし',
        occurredDate: event.occurredDate!,
        approvedGrade: currentGrade,
        canRevise: false,
      };
    }

    return {
      currentGrade,
      occurredDate: event.occurredDate!,
      revisionLabel: String(revision.calculatedGrade),
      approvedGrade: revision.calculatedGrade ?? currentGrade,
      canRevise: true,
    };
  }

  async buildInsuranceApprovalDraft(event: Event): Promise<InsuranceApprovalDraft | null> {
    const before = event.payload?.['before'] as Employee | undefined;
    const after = event.payload?.['after'] as Employee | undefined;
    if (!after) return null;

    const isSpecificApplicableOffice = await this.companyService.isSpecificApplicableOffice();
    const required = this.employeeLogicService.isInsuranceRequired(after, isSpecificApplicableOffice);
    const autoGrade = await this.employeeLogicService.getInsuranceGradeAtNewEntry(after);
    const today = this.formatDateInput(new Date());

    return {
      currentGrade: before?.insurance?.currentGrade ?? after.insurance?.currentGrade ?? 0,
      autoGrade: autoGrade ?? null,
      approvedGrade: autoGrade ?? after.insurance?.currentGrade ?? 0,
      currentHealthStatus: this.getActualStatus(before?.insurance?.healthInsurance),
      currentNursingStatus: this.getActualStatus(before?.insurance?.nursingCareInsurance),
      currentPensionStatus: this.getActualStatus(before?.insurance?.employeePensionInsurance),
      healthStatus: this.resolveAutoStatus(required.isHealthInsuranceRequired, before?.insurance?.healthInsurance),
      nursingStatus: this.resolveAutoStatus(required.isNursingCareInsuranceRequired, before?.insurance?.nursingCareInsurance),
      pensionStatus: this.resolveAutoStatus(required.isPensionInsuranceRequired, before?.insurance?.employeePensionInsurance),
      healthAcquiredDate: this.formatDateInput(after.insurance?.healthInsurance?.acquiredDate?.toDate()) || today,
      healthLostDate: this.formatDateInput(after.insurance?.healthInsurance?.lostDate?.toDate()),
      nursingAcquiredDate: this.formatDateInput(after.insurance?.nursingCareInsurance?.acquiredDate?.toDate()) || today,
      nursingLostDate: this.formatDateInput(after.insurance?.nursingCareInsurance?.lostDate?.toDate()),
      pensionAcquiredDate: this.formatDateInput(after.insurance?.employeePensionInsurance?.acquiredDate?.toDate()) || today,
      pensionLostDate: this.formatDateInput(after.insurance?.employeePensionInsurance?.lostDate?.toDate()),
    };
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
      ? this.calculationRunService.markRunApproved(runId, loginEmployeeId)
      : this.markEventApproved(employeeId, event, loginEmployeeId);
  }

  async approveInsuranceEvent(
    employeeId: string,
    event: Event,
    draft: InsuranceApprovalDraft,
    loginEmployeeId: string,
    runId?: string,
  ): Promise<boolean> {
    const employee = await this.employeeService.getEmployeeByEmployeeId(employeeId);
    if (!employee) return false;

    const insurance: EmployeeInsurance = {
      currentGrade: draft.approvedGrade,
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

    const updated: Partial<Employee> = {
      employeeId,
      workStatus: '退社済み',
      resignationDate,
      insurance: {
        currentGrade: 0,
        healthInsurance: this.buildLostInsuranceDetail(employee.insurance?.healthInsurance, resignationDate),
        nursingCareInsurance: this.buildLostInsuranceDetail(employee.insurance?.nursingCareInsurance, resignationDate),
        employeePensionInsurance: this.buildLostInsuranceDetail(employee.insurance?.employeePensionInsurance, resignationDate),
      },
    };

    const employeeUpdated = await this.employeeService.updateEmployee(updated);
    if (!employeeUpdated) return false;

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

    const occurredDate = event.occurredDate?.toDate();
    if (!occurredDate) return false;

    let updateEmployee: Partial<Employee> = {};
    switch (event.reachAgeType) {
      case '40歳':
        updateEmployee = {
          employeeId,
          insurance: {
            ...employee.insurance,
            nursingCareInsurance: {
              joined: true,
              acquiredDate: Timestamp.fromDate(occurredDate),
            },
          },
        };
        break;
      case '65歳':
        updateEmployee = {
          employeeId,
          insurance: {
            ...employee.insurance,
            nursingCareInsurance: {
              joined: false,
              lostDate: Timestamp.fromDate(occurredDate),
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
              joined: false,
              lostDate: Timestamp.fromDate(occurredDate),
            },
          },
        };
        break;
      case '75歳':
        updateEmployee = {
          employeeId,
          insurance: {
            ...employee.insurance,
            healthInsurance: {
              joined: false,
              lostDate: Timestamp.fromDate(occurredDate),
            },
          },
        };
        break;
      default:
        return false;
    }

    const employeeUpdated = await this.employeeService.updateEmployee(updateEmployee);
    if (!employeeUpdated) return false;

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
    const occurred = event.occurredDate?.toDate() ?? new Date();
    return addMonths(occurred.getFullYear(), occurred.getMonth() + 1, -3);
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
    const current = this.getActualStatus(currentDetail);
    if (!required) {
      if (current === 'joined') return 'lost';
      return current;
    }
    if (current === 'lost') return 'lost';
    return 'joined';
  }

  private getActualStatus(detail?: InsuranceDetail): InsuranceStatusKind {
    if (!detail) return 'notJoined';
    if (detail.joined) return 'joined';
    if (detail.lostDate) return 'lost';
    return 'notJoined';
  }

  private buildInsuranceDetailFromDraft(
    status: InsuranceStatusKind,
    acquiredDate: string,
    lostDate: string,
    existing?: InsuranceDetail,
  ): InsuranceDetail {
    if (status === 'notJoined') {
      return { joined: false };
    }

    const detail: InsuranceDetail = {
      joined: status === 'joined',
      companyBurdenRate: existing?.companyBurdenRate ?? 50,
    };

    if (existing?.number) {
      detail.number = existing.number;
    }

    if (status === 'joined' && acquiredDate) {
      detail.acquiredDate = Timestamp.fromDate(new Date(acquiredDate));
    }

    if (status === 'lost') {
      detail.joined = false;
      if (existing?.acquiredDate) {
        detail.acquiredDate = existing.acquiredDate;
      } else if (acquiredDate) {
        detail.acquiredDate = Timestamp.fromDate(new Date(acquiredDate));
      }
      if (lostDate) {
        detail.lostDate = Timestamp.fromDate(new Date(lostDate));
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