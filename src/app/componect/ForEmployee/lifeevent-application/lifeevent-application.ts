import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators, FormGroup, FormArray, AbstractControl } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Dependent } from '../../../model/dependent';
import { RELATIONSHIPS, Relationship, LifeEventType, LeaveType } from '../../../constants/model-constants';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { Employee } from '../../../model/employee';
import { DependentService } from '../../../service/Firestore/dependent-service';
import { EventService } from '../../../service/Firestore/event-service';
import { Timestamp } from '@angular/fire/firestore';
import { Event } from '../../../model/event';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { CREATE_MESSAGES } from '../../../constants/constants';
import { ValidationService } from '../../../service/common/validation-service';

type LifeEventTab = 'marriage' | 'birth' | 'name' | 'dependent';
type DependentCoverageStatus = 'dependent' | 'notDependent';

type DependentFormPayload = {
  dependentId: string;
  name: string;
  relationship: Relationship | '';
  birthDate: string;
  isDependent: boolean;
};

@Component({
  selector: 'app-lifeevent-application',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './lifeevent-application.html',
  styleUrl: './lifeevent-application.css',
})
export class LifeeventApplication {

  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);
  private employeeService = inject(EmployeeService);
  private dependentService = inject(DependentService);
  private eventService = inject(EventService);
  private commonService = inject(CommonService);
  private validationService = inject(ValidationService);

  RELATIONSHIPS = RELATIONSHIPS;
  activeTab: LifeEventTab = 'marriage';

  loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? '';
  employee: Employee | null = null;
  dependents: Dependent[] = [];

  message = '';
  private messageTimer: MessageTimer | null = null;

  marriageForm = this.fb.nonNullable.group({
    type: ['結婚' as '結婚' | '離婚', [Validators.required]],
    name: ['', [Validators.required]],
    occurredDate: ['', [Validators.required]],
    dependents: this.fb.array<FormGroup>([]),
  });

  birthForm = this.fb.nonNullable.group({
    type: ['出産' as '出産' | '育児', [Validators.required]],
    leaveTypes: ['産前産後' as '産前産後' | '育児' | 'なし', [Validators.required]],
    resignationDate: [''],
    childBirthDate: ['', [Validators.required]],
    dependents: this.fb.array<FormGroup>([]),
  });

  nameChangeForm = this.fb.nonNullable.group({
    name: ['', [Validators.required]],
  });

  dependentChangeForm = this.fb.nonNullable.group({
    dependents: this.fb.array<FormGroup>([]),
  });

  async ngOnInit() {
    const employee = await this.employeeService.getEmployeeByEmployeeId(this.loginEmployeeId);
    if (!employee) return;

    this.employee = employee;
    this.dependents = await this.dependentService.getDependents(this.loginEmployeeId);

    this.marriageForm.patchValue({ name: employee.firstName ?? '' });
    this.initMarriageDependents();
    this.initBirthDependents();
    this.nameChangeForm.patchValue({ name: employee.firstName ?? '' });
    this.initDependentChangeDependents();
  }

  setActiveTab(tab: LifeEventTab) {
    this.activeTab = tab;
  }

  getDependentById(dependentId: string): Dependent | undefined {
    return this.dependents.find(dependent => dependent.dependentId === dependentId);
  }

  private validateDependentArray(formArray: FormArray): boolean {
    let valid = true;
    for (const control of formArray.controls) {
      if (control.invalid) {
        control.markAllAsTouched();
        valid = false;
      }
    }
    return valid;
  }

  /** 結婚/離婚申請 */
  async submitMarriageForm() {
    if (this.marriageForm.invalid || !this.validateDependentArray(this.marriageDependents)) {
      this.marriageForm.markAllAsTouched();
      return;
    }

    const occurredDate = this.marriageForm.get('occurredDate')!.value;
    const lifeEventType = this.marriageForm.get('type')!.value as LifeEventType;
    let created = 0;

    if (this.marriageForm.get('name')!.value !== (this.employee?.firstName ?? '')) {
      const nameEvent: Partial<Event> = {
        occurredDate: Timestamp.fromDate(new Date(occurredDate)),
        eventType: '氏名変更',
        lifeEventType,
        appliedDate: Timestamp.now(),
        applicantType: '社員',
        approval: { approvalStatus: '申請中' },
        payload: {
          before: this.employee?.firstName ?? '',
          after: this.marriageForm.get('name')!.value,
        },
      };
      if (await this.eventService.createEvent(this.loginEmployeeId, nameEvent)) {
        created++;
      } else {
        this.showMessage(CREATE_MESSAGES.FAILED);
        return;
      }
    }

    const changedDependents = this.collectChangedDependents(this.marriageDependents);
    created += await this.createDependentEvents(changedDependents, occurredDate, lifeEventType);

    if (created === 0) {
      this.showMessage('変更内容がありません');
      return;
    }

    this.showMessage(`${created}件申請しました`);
    this.resetMarriageForm();
  }

  /** 出産/育児申請 */
  async submitBirthForm() {
    this.updateBirthLeaveValidators();
    if (this.birthForm.invalid || !this.validateDependentArray(this.birthDependents)) {
      this.birthForm.markAllAsTouched();
      return;
    }

    const lifeEventType = this.birthForm.get('type')!.value as LifeEventType;
    const leaveTypes = this.mapLeaveTypes(this.birthForm.get('leaveTypes')!.value);
    const leaveStart = this.birthForm.get('resignationDate')!.value;
    let created = 0;

    const afterEmployee: Employee = {
      ...this.employee!,
      leaveTypes,
      workStatus: leaveTypes ? '休職中' : '通常勤務',
    };

    if (
      this.employee?.leaveTypes !== afterEmployee.leaveTypes
      || this.employee?.workStatus !== afterEmployee.workStatus
    ) {
      const occurredDate = leaveStart || this.birthForm.get('childBirthDate')!.value;
      const leaveEvent: Partial<Event> = {
        occurredDate: Timestamp.fromDate(new Date(occurredDate)),
        eventType: '雇用形態変更',
        lifeEventType,
        appliedDate: Timestamp.now(),
        applicantType: '社員',
        approval: { approvalStatus: '申請中' },
        payload: { before: this.employee, after: afterEmployee },
      };
      if (await this.eventService.createEvent(this.loginEmployeeId, leaveEvent)) {
        created++;
      } else {
        this.showMessage(CREATE_MESSAGES.FAILED);
        return;
      }
    }

    const changedDependents = this.collectChangedDependents(this.birthDependents);
    const occurredDate = this.birthForm.get('childBirthDate')!.value;
    created += await this.createDependentEvents(changedDependents, occurredDate, lifeEventType);

    if (created === 0) {
      this.showMessage('変更内容がありません');
      return;
    }

    this.showMessage(`${created}件申請しました`);
    this.resetBirthForm();
  }

  /** 氏名変更申請 */
  async submitNameChangeForm() {
    if (this.nameChangeForm.invalid) {
      this.nameChangeForm.markAllAsTouched();
      return;
    }

    if (this.nameChangeForm.get('name')!.value === (this.employee?.firstName ?? '')) {
      this.showMessage('変更内容がありません');
      return;
    }

    const nameEvent: Partial<Event> = {
      occurredDate: Timestamp.now(),
      eventType: '氏名変更',
      lifeEventType: 'その他',
      appliedDate: Timestamp.now(),
      applicantType: '社員',
      approval: { approvalStatus: '申請中' },
      payload: {
        before: this.employee?.firstName ?? '',
        after: this.nameChangeForm.get('name')!.value,
      },
    };

    const result = await this.eventService.createEvent(this.loginEmployeeId, nameEvent);
    this.showMessage(result ? '申請しました' : CREATE_MESSAGES.FAILED);
    if (result) {
      this.nameChangeForm.patchValue({ name: this.employee?.firstName ?? '' });
    }
  }

  /** 扶養変更申請 */
  async submitDependentChangeForm() {
    if (this.dependentChangeForm.invalid || !this.validateDependentArray(this.dependentChangeDependents)) {
      this.dependentChangeForm.markAllAsTouched();
      return;
    }

    const changedDependents = this.collectChangedDependents(this.dependentChangeDependents);
    if (changedDependents.length === 0) {
      this.showMessage('変更内容がありません');
      return;
    }

    const count = await this.createDependentEvents(changedDependents, new Date().toISOString().slice(0, 10), 'その他');
    this.showMessage(count > 0 ? `${count}件申請しました` : CREATE_MESSAGES.FAILED);
    if (count > 0) {
      this.resetDependentChangeForm();
    }
  }

  addDependent(type: 1 | 2 | 3) {
    const form = this.createDependentForm();
    switch (type) {
      case 1: this.marriageDependents.push(form); break;
      case 2: this.birthDependents.push(form); break;
      case 3: this.dependentChangeDependents.push(form); break;
    }
  }

  get marriageDependents(): FormArray {
    return this.marriageForm.get('dependents') as FormArray;
  }

  get birthDependents(): FormArray {
    return this.birthForm.get('dependents') as FormArray;
  }

  get dependentChangeDependents(): FormArray {
    return this.dependentChangeForm.get('dependents') as FormArray;
  }

  getCurrentDependentStatusLabel(dependent?: Dependent): string {
    if (!dependent) return '—';
    return dependent.isDependent !== false ? '扶養' : '扶養ではない';
  }

  private initMarriageDependents() {
    this.marriageDependents.clear();
    this.dependents.forEach(dependent => {
      this.marriageDependents.push(this.createDependentForm(dependent));
    });
  }

  private initBirthDependents() {
    this.birthDependents.clear();
    if (this.dependents.length > 0) {
      this.dependents.forEach(dependent => {
        this.birthDependents.push(this.createDependentForm(dependent));
      });
    } else {
      this.birthDependents.push(this.createDependentForm());
    }
  }

  private initDependentChangeDependents() {
    this.dependentChangeDependents.clear();
    if (this.dependents.length > 0) {
      this.dependents.forEach(dependent => {
        this.dependentChangeDependents.push(this.createDependentForm(dependent));
      });
    } else {
      this.dependentChangeDependents.push(this.createDependentForm());
    }
  }

  private createDependentForm(existing?: Dependent): FormGroup {
    const group = this.fb.nonNullable.group({
      dependentId: [existing?.dependentId ?? ''],
      isExisting: [!!existing],
      name: [existing?.name ?? '', [this.validationService.requiredIfAnyDependentFieldEntered]],
      relationship: [(existing?.relationship ?? '') as Relationship | '', [this.validationService.requiredIfAnyDependentFieldEntered]],
      birthDate: [
        existing?.birthDate ? this.formatDateInput(existing.birthDate.toDate()) : '',
        [this.validationService.requiredIfAnyDependentFieldEntered, this.validationService.birthDateValidator],
      ],
      isDependentStatus: [
        (existing ? (existing.isDependent !== false ? 'dependent' : 'notDependent') : 'dependent') as DependentCoverageStatus,
      ],
    });

    (['name', 'birthDate', 'relationship'] as const).forEach(fieldName => {
      group.get(fieldName)?.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.validationService.refreshDependentRowValidation(group));
    });

    return group;
  }

  private collectChangedDependents(formArray: FormArray): { before: Dependent | null; after: DependentFormPayload }[] {
    const results: { before: Dependent | null; after: DependentFormPayload }[] = [];

    for (const control of formArray.controls) {
      const group = control as FormGroup;
      const raw = group.getRawValue();
      const after = this.toDependentPayload(raw);
      const before = raw.dependentId
        ? this.dependents.find(dependent => dependent.dependentId === raw.dependentId) ?? null
        : null;

      if (!before && !this.hasDependentInput(raw)) continue;
      if (before && !this.hasDependentChanged(raw, before)) continue;
      if (!before && !this.hasDependentInput(raw)) continue;

      results.push({ before, after });
    }

    return results;
  }

  private async createDependentEvents(
    items: { before: Dependent | null; after: DependentFormPayload }[],
    occurredDate: string,
    lifeEventType: LifeEventType,
  ): Promise<number> {
    let count = 0;

    for (const item of items) {
      const afterDependent: Dependent = {
        dependentId: item.after.dependentId || this.getNextDependentId(),
        name: item.after.name,
        relationship: item.after.relationship as Relationship,
        birthDate: Timestamp.fromDate(new Date(item.after.birthDate)),
        isDependent: item.after.isDependent,
      };

      const dependentEvent: Partial<Event> = {
        occurredDate: Timestamp.fromDate(new Date(occurredDate)),
        eventType: '扶養情報変更',
        lifeEventType,
        appliedDate: Timestamp.now(),
        applicantType: '社員',
        approval: { approvalStatus: '申請中' },
        payload: {
          before: item.before,
          after: afterDependent,
        },
      };

      if (await this.eventService.createEvent(this.loginEmployeeId, dependentEvent)) {
        count++;
      }
    }

    return count;
  }

  private hasDependentInput(raw: Record<string, unknown>): boolean {
    return !!(raw['name'] || raw['relationship'] || raw['birthDate']);
  }

  private hasDependentChanged(raw: Record<string, unknown>, before: Dependent): boolean {
    const after = this.toDependentPayload(raw);
    const beforePayload = {
      name: before.name ?? '',
      relationship: before.relationship ?? '',
      birthDate: before.birthDate ? this.formatDateInput(before.birthDate.toDate()) : '',
      isDependent: before.isDependent !== false,
    };
    return JSON.stringify(beforePayload) !== JSON.stringify(after);
  }

  private toDependentPayload(raw: Record<string, unknown>): DependentFormPayload {
    return {
      dependentId: String(raw['dependentId'] ?? ''),
      name: String(raw['name'] ?? '').trim(),
      relationship: raw['relationship'] as Relationship | '',
      birthDate: String(raw['birthDate'] ?? ''),
      isDependent: raw['isDependentStatus'] === 'dependent',
    };
  }

  private mapLeaveTypes(value: string): LeaveType | undefined {
    if (value === '産前産後' || value === '育児') return value;
    return undefined;
  }

  private updateBirthLeaveValidators() {
    const needsLeaveDate = this.birthForm.get('leaveTypes')!.value !== 'なし';
    const control = this.birthForm.get('resignationDate')!;
    if (needsLeaveDate) {
      control.setValidators([Validators.required]);
    } else {
      control.clearValidators();
    }
    control.updateValueAndValidity();
  }

  private getNextDependentId(): string {
    const ids = this.dependents
      .map(dependent => Number(dependent.dependentId))
      .filter(id => Number.isFinite(id));
    return String((ids.length ? Math.max(...ids) : 0) + 1);
  }

  private formatDateInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private resetMarriageForm() {
    this.marriageForm.patchValue({
      type: '結婚',
      name: this.employee?.firstName ?? '',
      occurredDate: '',
    });
    this.initMarriageDependents();
  }

  private resetBirthForm() {
    this.birthForm.patchValue({
      type: '出産',
      leaveTypes: '産前産後',
      resignationDate: '',
      childBirthDate: '',
    });
    this.initBirthDependents();
  }

  private resetDependentChangeForm() {
    this.initDependentChangeDependents();
  }

  private showMessage(message: string) {
    this.messageTimer = this.commonService.showTimedMessage(
      message,
      value => this.message = value,
      this.messageTimer,
    );
  }
}
