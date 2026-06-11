import { ChangeDetectorRef, Component, DestroyRef, computed, inject } from '@angular/core';
import { EmployeeService } from '../../../../service/Firestore/employee-service';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Employee } from '../../../../model/employee';
import { AbstractControl, ValidationErrors, Validators } from '@angular/forms';
import { timestampFromDateInput } from '../../../../service/common/date-input.util';
import { WorkStatus, EmploymentCategory, WorkStyle, WORK_STATUSES, EMPLOYMENT_CATEGORIES, WORK_STYLES, LEAVE_TYPES, LeaveType, GENDERS, Gender } from '../../../../constants/model-constants';
import { EmploymentContract } from '../../../../model/employee';
import { CREATE_MESSAGES } from '../../../../constants/constants';
import { OfficeService } from '../../../../service/Firestore/office-service';
import { CommonService, MessageTimer } from '../../../../service/common/common-service';
import { AddEmployeeByCSVService, CsvEmployeePreviewRow } from '../../../../service/CSV/addEmployeeByCSV-service';
import { ValidationService } from '../../../../service/common/validation-service';
import { Router } from '@angular/router';
import { EmployeeList } from '../../../employee/employee-list/employee-list';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

/**
 * 社員情報初期登録画面（個別登録、CSV一括登録）
 */

@Component({
  selector: 'app-employee-form',
  imports: [CommonModule, ReactiveFormsModule, EmployeeList],
  templateUrl: './employee-form.html',
  styleUrl: './employee-form.css',
})
export class EmployeeForm {

  private employeeService = inject(EmployeeService);
  private fb = inject(FormBuilder);
  private officeService = inject(OfficeService);
  private addEmployeeByCSVService = inject(AddEmployeeByCSVService);
  private cdr = inject(ChangeDetectorRef);
  private validationService = inject(ValidationService);
  commonService = inject(CommonService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  WORK_STATUSES = WORK_STATUSES;
  LEAVE_TYPES = LEAVE_TYPES;
  EMPLOYMENT_CATEGORIES = EMPLOYMENT_CATEGORIES;
  WORK_STYLES = WORK_STYLES;
  GENDERS = GENDERS;

  companyId = sessionStorage.getItem('companyId');

  officeNameMap = computed(() => this.officeService.allOfficeNameMap());



  form = this.fb.nonNullable.group({
    employeeId: ['', [Validators.required, Validators.pattern('^[a-zA-Z0-9]+$')], [this.validationService.validateEmployeeId]],
    firstName: ['', [Validators.required]],
    lastName: ['', [Validators.required]],
    birthDate: ['', [Validators.required, this.validationService.birthDateValidator]],
    gender: ['', [Validators.required]],
    hireDate: ['', [Validators.required]],
    workStatus: ['通常勤務', [Validators.required]],
    leaveTypes: [''],
    employmentContract: this.fb.nonNullable.group({
      employmentCategory: ['正社員', [Validators.required]],
      workStyle: ['フルタイム', [Validators.required]],
      officeId: ['', [Validators.required]],
      contractedWorkingHoursPerWeek: ['40', [Validators.min(0)]],
      contractedWorkingDaysPerMonth: ['20', [Validators.min(0)]],
      fixedSalary: ['', [Validators.required, Validators.min(0)]],
      transportationExpenses: ['', [Validators.min(0)]],
    }),
  });

  message: string = '';
  individualRegisterMessage: string = '';
  selectedCsvFileName: string = '';
  selectedCsvFile: File | null = null;
  csvImportMessage: string = '';
  csvPreviewRows: CsvEmployeePreviewRow[] = [];
  csvPreviewModalOpen: boolean = false;
  private pageMessageTimer: MessageTimer = null;
  private individualMessageTimer: MessageTimer = null;
  private csvMessageTimer: MessageTimer = null;

  async ngOnInit() {
    const message = history.state.message;
    if (message) {
      this.pageMessageTimer = this.commonService.showTimedMessage(message, value => this.message = value, this.pageMessageTimer);
      history.replaceState({}, '');
    }

    //事業所のマップを取得
    await this.officeService.getAllOffice();
    //社員のマップを取得
    await this.employeeService.getAllEmployees();
    this.setupTransportationExpensesValidation();
    this.setupLeaveTypesValidation();
    this.setupWorkStyleAutoSelection();
    
    //編集権限確認（パラムとセッションの一致確認、トップ権限か確認）

  }

  private setupWorkStyleAutoSelection() {
    const employmentContract = this.form.controls.employmentContract;
  
    employmentContract.controls.employmentCategory.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(category => {
  
        const workStyleControl = employmentContract.controls.workStyle;
  
        if (category === 'パート') {
          workStyleControl.setValue('パート', { emitEvent: false });
        } else if (
          workStyleControl.value === 'パート'
        ) {
          // パート以外に戻した時だけフルタイムへ
          workStyleControl.setValue('フルタイム', { emitEvent: false });
        }
      });
  }


  /** 新規従業員登録（個別） */
  async registerByIndividual() {

    this.clearIndividualRegisterMessage();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    //雇用契約情報を登録用に変換
    const employmentContract: Partial<EmploymentContract> = {
      employmentCategory: this.form.value.employmentContract?.employmentCategory! as EmploymentCategory,
      workStyle: this.form.value.employmentContract?.workStyle! as WorkStyle,
      officeId: this.form.value.employmentContract?.officeId!,
      contractedWorkingHoursPerWeek: Number(this.form.value.employmentContract?.contractedWorkingHoursPerWeek),
      contractedWorkingDaysPerMonth: Number(this.form.value.employmentContract?.contractedWorkingDaysPerMonth),
      fixedSalary: Number(this.form.value.employmentContract?.fixedSalary!),
      ...(this.form.value.employmentContract?.transportationExpenses !== ''
        ? { transportationExpenses: Number(this.form.value.employmentContract?.transportationExpenses) }
        : {}),
    };

    //従業員情報を登録用に変換
    const employee: Partial<Employee> = {
      employeeId: this.form.value.employeeId!,
      firstName: this.form.value.firstName!,
      lastName: this.form.value.lastName!,
      birthDate: timestampFromDateInput(this.form.value.birthDate!),
      gender: this.form.value.gender! as Gender,
      hireDate: timestampFromDateInput(this.form.value.hireDate!),
      workStatus: this.form.value.workStatus! as WorkStatus,
      ...(this.form.value.workStatus === '休職中'
        ? { leaveTypes: this.form.value.leaveTypes! as LeaveType }
        : {}),
      employmentContract: employmentContract,
    };

    const result = await this.employeeService.registerEmployee(employee);
    if (!result) {
      this.showIndividualRegisterMessage(CREATE_MESSAGES.FAILED);
      return;
    }
    this.showIndividualRegisterMessage(`社員ID：${this.form.value.employeeId!}　${this.form.value.firstName!} ${this.form.value.lastName!}さんを${CREATE_MESSAGES.SUCCESS}`);
    this.form.reset();
    this.employeeService.getAllEmployees(true);
  }

  resetForm() {
    this.form.reset();
    this.clearIndividualRegisterMessage();
  }

  /** CSVひな形ダウンロード */
  downloadCsvTemplate() {
    this.addEmployeeByCSVService.downloadCsvTemplate();
  }

  /** 新規従業員登録（一括CSV取り込み） */
  /** CSVファイル選択 */
  onCsvFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    this.setCsvImportStatus('');
    this.csvPreviewRows = [];
    this.csvPreviewModalOpen = false;
    if (!file) {
      this.selectedCsvFileName = '';
      this.selectedCsvFile = null;
      this.setCsvImportStatus('CSVファイルが選択されていません');
      return;
    }

    this.selectedCsvFileName = file.name;
    this.selectedCsvFile = file;
    this.setCsvImportStatus('');
  }

  /** 新規従業員登録（一括CSV取り込み） */
  async importCsv() {
    if (!this.selectedCsvFile) {
      this.setCsvImportStatus('CSVファイルを選択してください');
      return;
    }

    this.csvPreviewRows = [];
    this.csvPreviewModalOpen = false;
    this.setCsvImportStatus('CSV内容を確認中です');
    try {
      const result = await this.addEmployeeByCSVService.previewCsv(this.selectedCsvFile);
      this.csvPreviewRows = result.rows;
      this.csvPreviewModalOpen = result.rows.length > 0;
      this.setCsvImportStatus(result.message);
    } catch (error) {
      console.error(error);
      this.setCsvImportStatus('CSV内容の確認に失敗しました');
    }
  }

  setCsvPreviewRowSelected(row: CsvEmployeePreviewRow, checked: boolean) {
    row.selected = checked;
  }

  async registerSelectedCsvRows() {
    this.setCsvImportStatus('選択された社員を登録中です');
    try {
      const result = await this.addEmployeeByCSVService.registerPreviewRows(this.csvPreviewRows);
      this.csvPreviewModalOpen = false;
      this.setCsvImportStatus(result.message);
      await this.employeeService.getAllEmployees(true);
    } catch (error) {
      console.error(error);
      this.setCsvImportStatus('チェックした社員の登録に失敗しました');
    }
  }

  selectedCsvPreviewCount() {
    return this.csvPreviewRows.filter(row => row.selected && row.canRegister).length;
  }

  selectAllCsvPreviewRows() {
    this.csvPreviewRows.forEach(row => {
      if (row.canRegister) {
        row.selected = true;
      }
    });
  }

  clearAllCsvPreviewRows() {
    this.csvPreviewRows.forEach(row => {
      row.selected = false;
    });
  }

  closeCsvPreviewModal() {
    this.csvPreviewModalOpen = false;
  }

  private setCsvImportStatus(message: string) {
    this.csvMessageTimer = this.commonService.showTimedMessage(message, value => this.csvImportMessage = value, this.csvMessageTimer);
    this.cdr.detectChanges();
  }

  private showIndividualRegisterMessage(message: string) {
    this.individualMessageTimer = this.commonService.showTimedMessage(message, value => this.individualRegisterMessage = value, this.individualMessageTimer);
  }

  private clearIndividualRegisterMessage() {
    this.individualMessageTimer = this.commonService.clearTimedMessage(value => this.individualRegisterMessage = value, this.individualMessageTimer);
  }

  private setupTransportationExpensesValidation() {
    const employmentContract = this.form.controls.employmentContract;
    this.updateTransportationExpensesValidation();
    employmentContract.controls.employmentCategory.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateTransportationExpensesValidation());
    employmentContract.controls.workStyle.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateTransportationExpensesValidation());
  }

  private setupLeaveTypesValidation() {
    this.updateLeaveTypesValidation();
    this.form.controls.workStatus.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateLeaveTypesValidation());
  }

  private updateLeaveTypesValidation() {
    const leaveTypesControl = this.form.controls.leaveTypes;
    const isLeaveTypesRequired = this.form.controls.workStatus.value === '休職中';

    leaveTypesControl.setValidators(isLeaveTypesRequired ? [Validators.required] : null);
    if (!isLeaveTypesRequired) {
      leaveTypesControl.setValue('', { emitEvent: false });
    }
    leaveTypesControl.updateValueAndValidity({ emitEvent: false });
  }

  showLeaveTypesField() {
    return this.form.controls.workStatus.value === '休職中';
  }

  private updateTransportationExpensesValidation() {
    const employmentContract = this.form.controls.employmentContract;
    const transportationExpensesControl = employmentContract.controls.transportationExpenses;
    const isTransportationExpensesRequired = this.isTransportationExpensesRequired(
      employmentContract.controls.employmentCategory.value as EmploymentCategory,
      employmentContract.controls.workStyle.value as WorkStyle,
    );

    transportationExpensesControl.setValidators(
      isTransportationExpensesRequired
        ? [Validators.required, Validators.min(0)]
        : [Validators.min(0)]
    );
    if (!isTransportationExpensesRequired) {
      transportationExpensesControl.setValue('', { emitEvent: false });
    }
    transportationExpensesControl.updateValueAndValidity({ emitEvent: false });
  }

  showTransportationExpensesField() {
    const employmentContract = this.form.controls.employmentContract;
    return this.isTransportationExpensesRequired(
      employmentContract.controls.employmentCategory.value as EmploymentCategory,
      employmentContract.controls.workStyle.value as WorkStyle,
    );
  }

  private isTransportationExpensesRequired(employmentCategory: EmploymentCategory, workStyle: WorkStyle) {
    return (employmentCategory === '契約社員' && workStyle === '時短') || employmentCategory === 'パート';
  }

  toOfficeForm() {
    this.router.navigate([`/initial-setting/${this.companyId}/office-form`]);
  }

  toUserForm() {
    const confirmed = window.confirm(
      'ご自身の社員情報は登録済みでしょうか。\n' +
      '登録済みであれば連携に進むを押してください。\n' +
      '未登録であればキャンセルを押して、社員登録をお願いいたします。'
    );
    if (!confirmed) {
      return;
    }

    sessionStorage.removeItem('companyId');
    this.router.navigate(['/initial-setting/user-form'], { state: { finishedCompanyForm: true } });
  }

}

