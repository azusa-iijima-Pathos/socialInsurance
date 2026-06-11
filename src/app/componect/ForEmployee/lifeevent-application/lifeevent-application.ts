import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators, FormGroup, FormArray, AbstractControl, ValidationErrors } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Dependent } from '../../../model/dependent';
import { RELATIONSHIPS, Relationship, LifeEventType, LeaveType } from '../../../constants/model-constants';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { Employee } from '../../../model/employee';
import { DependentService } from '../../../service/Firestore/dependent-service';
import { EventService } from '../../../service/Firestore/event-service';
import { parseDateInputValue, timestampFromDateInput } from '../../../service/common/date-input.util';
import { Timestamp } from '@angular/fire/firestore';
import { Event } from '../../../model/event';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { CREATE_MESSAGES } from '../../../constants/constants';
import { ValidationService } from '../../../service/common/validation-service';
import { CompanyService } from '../../../service/Firestore/company-service';
import { buildEventId, getWorkMonthForDate, getWorkingYearMonth } from '../../../service/logic/event-id-service';
import { Router } from '@angular/router';

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
  styleUrls: [
    './lifeevent-application.css',
    '../../employee/employee-detail/employee-detail.css',
    '../../correction/retroactive-correction/retroactive-correction.css',
  ],
})
export class LifeeventApplication {

  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);
  private employeeService = inject(EmployeeService);
  private dependentService = inject(DependentService);
  private eventService = inject(EventService);
  private commonService = inject(CommonService);
  private validationService = inject(ValidationService);
  private companyService = inject(CompanyService);

  RELATIONSHIPS = RELATIONSHIPS;
  activeTab: LifeEventTab = 'marriage';

  loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? '';
  employee: Employee | null = null;
  dependents: Dependent[] = [];

  message = '';
  private messageTimer: MessageTimer | null = null;

  dateValidMessage = '';

  marriageForm = this.fb.nonNullable.group({
    type: ['結婚' as '結婚' | '離婚', [Validators.required]],
    name: ['', [Validators.required]],
    occurredDate: ['', [Validators.required]],
    dependents: this.fb.array<FormGroup>([]),
  });

  birthForm = this.fb.nonNullable.group({
    type: ['出産' as '出産' | '育児', [Validators.required]],
    leaveTypes: ['産前産後' as '産前産後' | '育児' | 'なし', [Validators.required]],
    isMultipleBirth: [false],
    resignationDate: [''],
    childBirthDate: ['', [Validators.required]],
    dependents: this.fb.array<FormGroup>([]),
  },
    { validators: [this.childBirthDateValidator, this.birthTypeValidator, this.birthLeaveDateValidator] },
  );

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

    this.birthForm.get('type')?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(type => {
        if (type === '出産') {
          this.birthForm.patchValue({
            leaveTypes: '産前産後'
          });
        }
        if (type === '育児') {
          this.birthForm.patchValue({
            leaveTypes: '育児'
          });
          this.birthDependents.push(
            this.createDependentForm()
          );
        }
      });
  }

  setActiveTab(tab: LifeEventTab) {
    this.dateValidMessage = '';
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
    const nameChanged = this.marriageForm.get('name')!.value !== (this.employee?.firstName ?? '');
    const changedDependents = this.collectChangedDependents(this.marriageDependents);
    if (this.hasBlockedDependentRegistration(changedDependents)) {
      this.showMessage('健康保険に加入していないため、扶養の登録はできません。');
      this.resetMarriageForm();
      this.resetDependentChangeForm();
      return;
    }

    if (!nameChanged && changedDependents.length === 0) {
      this.showMessage('変更内容がありません');
      this.resetMarriageForm();
      this.resetDependentChangeForm();
      return;
    }

    let created = 0;
    let failed = false;

    if (nameChanged) {
      const nameEvent: Partial<Event> = {
        occurredDate: timestampFromDateInput(occurredDate),
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
        this.resetMarriageForm();
        this.resetDependentChangeForm();
        this.showMessage(`申請に失敗しました。${CREATE_MESSAGES.FAILED}`);
        return;
      }
    }

    const dependentResult = await this.createDependentEvents(changedDependents, occurredDate, lifeEventType);
    created += dependentResult.success;
    failed = dependentResult.failed;

    if (failed) {
      this.showMessage('一部の扶養申請に失敗しました。申請一覧から内容を確認してください。');
      this.resetMarriageForm();
      this.resetDependentChangeForm();
      return;
    }

    if (created === 0) {
      this.showMessage('変更内容がありません');
      this.resetMarriageForm();
      this.resetDependentChangeForm();
      return;
    }

    this.showMessage(`${created}件申請しました`);
    this.resetMarriageForm();
    this.resetDependentChangeForm();
  }

  /** 出産/育児申請 */
  async submitBirthForm() {
    this.dateValidMessage = '';
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
      if (leaveTypes && leaveStart) {
        const allowed = await this.isLeaveStartAllowed(leaveStart);
        if (!allowed) {
          this.dateValidMessage = '休職開始日は現在の作業月以降の日付を指定してください';
          return;
        }
      }

      const expectedBirthDate = parseDateInputValue(this.birthForm.get('childBirthDate')!.value);
      const leaveEvent: Partial<Event> = {
        eventType: '勤務状況変更',
        lifeEventType,
        appliedDate: Timestamp.now(),
        applicantType: '社員',
        approval: { approvalStatus: '申請中' },
        payload: { before: this.employee, after: afterEmployee, expectedBirthDate: Timestamp.fromDate(expectedBirthDate), isMultipleBirth: this.birthForm.get('isMultipleBirth')!.value ?? false },
      };

      let leaveCreated = false;
      if (leaveTypes && leaveStart) {
        leaveEvent.occurredDate = timestampFromDateInput(leaveStart);
        await this.companyService.getCompany();
        const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
        const leaveEventBaseId = buildEventId('勤務状況変更', '社員', {
          occurredDate: parseDateInputValue(leaveStart),
          targetPeriodStart,
        });
        leaveCreated = !!(await this.eventService.createEventWithBaseId(this.loginEmployeeId, leaveEventBaseId, leaveEvent));
      } else {
        const occurredDate = leaveStart || this.birthForm.get('childBirthDate')!.value;
        leaveEvent.occurredDate = timestampFromDateInput(occurredDate);
        leaveCreated = !!(await this.eventService.createEvent(this.loginEmployeeId, leaveEvent));
      }

      if (leaveCreated) {
        created++;
      } else {
        this.resetBirthForm();
        this.resetDependentChangeForm();
        this.showMessage(`申請に失敗しました。${CREATE_MESSAGES.FAILED}`);
        return;
      }
    }

    const changedDependents = this.collectChangedDependents(this.birthDependents);
    if (this.hasBlockedDependentRegistration(changedDependents)) {
      this.showMessage('健康保険に加入していないため、扶養の登録はできません。');
      this.resetBirthForm();
      this.resetDependentChangeForm();
      return;
    }

    const occurredDate = this.birthForm.get('childBirthDate')!.value;
    const dependentResult = await this.createDependentEvents(changedDependents, occurredDate, lifeEventType);
    created += dependentResult.success;
    if (dependentResult.failed) {
      this.showMessage('一部の扶養申請に失敗しました。申請一覧から内容を確認してください。');
      this.resetBirthForm();
      this.resetDependentChangeForm();
      return;
    }

    if (created === 0) {
      this.showMessage('変更内容がありません');
      this.resetBirthForm();
      this.resetDependentChangeForm();
      return;
    }

    this.showMessage(`${created}件申請しました`);
    this.resetDependentChangeForm();
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
      this.resetNameChangeForm();
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
    this.showMessage(result ? '申請しました' : `申請に失敗しました。${CREATE_MESSAGES.FAILED}`);
    this.resetNameChangeForm();
  }

  /** 扶養変更申請 */
  async submitDependentChangeForm() {
    if (this.dependentChangeForm.invalid || !this.validateDependentArray(this.dependentChangeDependents)) {
      this.dependentChangeForm.markAllAsTouched();
      return;
    }

    const changedDependents = this.collectChangedDependents(this.dependentChangeDependents);
    if (this.hasBlockedDependentRegistration(changedDependents)) {
      this.showMessage('健康保険に加入していないため、扶養の登録はできません。');
      this.resetDependentChangeForm();
      return;
    }
    if (changedDependents.length === 0) {
      this.showMessage('変更内容がありません');
      this.resetDependentChangeForm();
      return;
    }

    const count = await this.createDependentEvents(changedDependents, new Date().toISOString().slice(0, 10), 'その他');
    if (count.failed) {
      this.showMessage(`申請に失敗しました。${CREATE_MESSAGES.FAILED}`);
      this.resetDependentChangeForm();
      return;
    }
    if (count.success === 0) {
      this.showMessage('変更内容がありません');
      this.resetDependentChangeForm();
      return;
    }
    this.showMessage(`${count.success}件申請しました`);
    this.resetDependentChangeForm();
  }

  addDependent(type: 1 | 2 | 3) {
    if (!this.canRegisterDependent()) {
      this.showMessage('健康保険に加入していないため、扶養の登録はできません。');
      this.resetDependentChangeForm();
      return;
    }
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

  private async isLeaveStartAllowed(leaveStart: string): Promise<boolean> {
    await this.companyService.getCompany();
    const targetPeriodStart = this.companyService.company()?.settings?.targetPeriod[0] ?? 1;
    const workMonth = getWorkMonthForDate(parseDateInputValue(leaveStart), targetPeriodStart);
    const working = getWorkingYearMonth();
    return workMonth.year * 12 + workMonth.month >= working.year * 12 + working.month;
  }

  private initMarriageDependents() {
    this.marriageDependents.clear();
    this.dependents.forEach(dependent => {
      this.marriageDependents.push(this.createDependentForm(dependent));
    });
  }

  private initBirthDependents() {
    this.birthDependents.clear();
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

  private hasBlockedDependentRegistration(items: { before: Dependent | null; after: DependentFormPayload }[]): boolean {
    if (this.canRegisterDependent()) return false;
    return items.some(item => !item.before || item.after.isDependent);
  }

  canRegisterDependent(): boolean {
    return this.employee?.insurance?.healthInsurance?.joined === true;
  }

  /** 扶養情報変更申請 */
  private async createDependentEvents(
    items: { before: Dependent | null; after: DependentFormPayload }[],
    occurredDate: string,
    lifeEventType: LifeEventType,
  ): Promise<{ success: number; failed: boolean }> {
    let success = 0;
    let failed = false;
    let nextDependentId = Number(this.getNextDependentId());

    for (const item of items) {
      const afterDependent: Dependent = {
        dependentId: item.after.dependentId || String(nextDependentId++),
        name: item.after.name,
        relationship: item.after.relationship as Relationship,
        birthDate: timestampFromDateInput(item.after.birthDate),
        isDependent: item.after.isDependent ?? true, //記載がない場合は扶養として登録
      };

      const dependentEvent: Partial<Event> = {
        occurredDate: timestampFromDateInput(occurredDate),
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
        success++;
      } else {
        failed = true;
      }
    }

    return { success, failed };
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
    const afterPayload = {
      name: after.name,
      relationship: after.relationship,
      birthDate: after.birthDate,
      isDependent: after.isDependent,
    };
    return JSON.stringify(beforePayload) !== JSON.stringify(afterPayload);
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
    this.clearFormState(this.marriageForm);
  }

  private resetBirthForm() {
    this.birthForm.patchValue({
      type: '出産',
      leaveTypes: '産前産後',
      isMultipleBirth: false,
      resignationDate: '',
      childBirthDate: '',
    });
    this.birthForm.get('resignationDate')?.clearValidators();
    this.birthForm.get('resignationDate')?.updateValueAndValidity({ emitEvent: false });
    this.initBirthDependents();
    this.dateValidMessage = '';
    this.clearFormState(this.birthForm);
  }

  private resetNameChangeForm() {
    this.nameChangeForm.patchValue({ name: this.employee?.firstName ?? '' });
    this.clearFormState(this.nameChangeForm);
  }

  private resetDependentChangeForm() {
    this.initDependentChangeDependents();
    this.clearFormState(this.dependentChangeForm);
  }

  private clearFormState(form: FormGroup) {
    form.markAsUntouched();
    form.markAsPristine();
  }

  private showMessage(message: string) {
    this.messageTimer = this.commonService.showTimedMessage(
      message,
      value => this.message = value,
      this.messageTimer,
    );
  }


  private childBirthDateValidator(control: AbstractControl): ValidationErrors | null {
    const type = control.get('type')?.value;
    const childBirthDate = control.get('childBirthDate')?.value;
    if (!childBirthDate) {
      return null;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = parseDateInputValue(childBirthDate);
    // 出産予定日
    if (type === '出産' && targetDate < today) {
      return {
        invalidBirthDate: '出産予定日は今日以降を入力してください'
      };
    }
    // 子どもの誕生日
    if (type === '育児' && targetDate >= today) {
      return {
        invalidBirthDate: '子どもの誕生日は今日以前を入力してください'
      };
    }
    return null;
  }

  birthTypeValidator(control: AbstractControl) {
    const type = control.get('type')?.value;
    const leaveTypes = control.get('leaveTypes')?.value;
    if (
      type === '出産' &&
      leaveTypes === '育児'
    ) {
      return {
        invalidLeaveType: '出産では育児休業は選択できません'
      };
    }
    if (
      type === '育児' &&
      leaveTypes === '産前産後'
    ) {
      return {
        invalidLeaveType: '育児では産前産後休業は選択できません'
      };
    }
    return null;
  }

  private birthLeaveDateValidator(control: AbstractControl) {
    const leaveType = control.get('leaveTypes')?.value;
    const childBirthDate = control.get('childBirthDate')?.value;
    const leaveStartDate = control.get('resignationDate')?.value;
    const isMultipleBirth = control.get('isMultipleBirth')?.value;

    if (!childBirthDate || !leaveStartDate) {
      return null;
    }
    const birthDate = parseDateInputValue(childBirthDate);
    const startDate = parseDateInputValue(leaveStartDate);
    // 育休
    if (
      leaveType === '育児' &&
      startDate < birthDate
    ) {
      return {
        invalidLeaveStartDate:
          '育児休業開始日は出生日以降を入力してください'
      };
    }
    // 産前産後休業
    if (
      leaveType === '産前産後'
    ) {
      const days = isMultipleBirth ? 98 : 42;
      const minStartDate = new Date(birthDate);
      minStartDate.setDate(minStartDate.getDate() - days);

      if (startDate < minStartDate) {
        return {
          invalidLeaveStartDate:
            `産前産後休業開始日は出産予定日の${days}日前以降を入力してください`
        };
      }
    }
    return null;
  }

  private router = inject(Router);
  toMyApplication() {
    this.router.navigate(['/my-application']);
  }
}