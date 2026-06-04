import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { FormGroup, FormArray } from '@angular/forms';
import { Dependent } from '../../../model/dependent';
import { RELATIONSHIPS, Relationship } from '../../../constants/model-constants';
import { EmployeeService } from '../../../service/Firestore/employee-service';
import { Employee } from '../../../model/employee';
import { DependentService } from '../../../service/Firestore/dependent-service';
import { EventService } from '../../../service/Firestore/event-service';
import { Timestamp } from '@angular/fire/firestore';
import { Event } from '../../../model/event';
import { LifeEventType } from '../../../constants/model-constants';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { CREATE_MESSAGES } from '../../../constants/constants';
import { ValidationService } from '../../../service/common/validation-service';

@Component({
  selector: 'app-lifeevent-application',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './lifeevent-application.html',
  styleUrl: './lifeevent-application.css',
})
export class LifeeventApplication {

  private fb = inject(FormBuilder);
  private employeeService = inject(EmployeeService);
  private dependentService = inject(DependentService);
  private eventService = inject(EventService);
  private commonService = inject(CommonService);
  private validationService = inject(ValidationService);

  RELATIONSHIPS = RELATIONSHIPS;

  loginEmployeeId = sessionStorage.getItem('loginEmployeeId') ?? '';
  employee: Employee | null = null;
  dependents: Dependent[] = [];

  message = '';
  MessageTimer: MessageTimer | null = null;

  async ngOnInit() {
    const employee = await this.employeeService.getEmployeeByEmployeeId(this.loginEmployeeId);
    if (employee) {
      this.employee = employee;

      //扶養情報を取得
      this.dependents = await this.dependentService.getDependents(this.loginEmployeeId);

      //結婚/離婚申請フォームに値をセット
      this.marriageForm.patchValue({
        name: this.employee?.firstName ?? '',
        dependents: this.dependents.map(dependent => this.createDependentForm().patchValue(dependent)),
      });

      //出産/育児申請フォームに値をセット
      this.birthForm.patchValue({
        dependents: this.dependents.map(dependent => this.createDependentForm().patchValue(dependent)),
      });

      //氏名変更申請フォームに値をセット
      this.nameChangeForm.patchValue({
        name: this.employee?.firstName ?? '',
      });

      //扶養変更申請フォームに値をセット
      this.dependentChangeForm.patchValue({
        dependents: this.dependents.map(dependent => this.createDependentForm().patchValue(dependent)),
      });
    }
  }

  marriageForm = this.fb.nonNullable.group({
    type: ['結婚' as '結婚' | '離婚', [Validators.required]],
    name: ['', [Validators.required]],
    occurredDate: ['', [Validators.required]],
    dependents: this.fb.array<FormGroup>([]),
  });

  /** 結婚/離婚申請 */
  async submitMarriageForm() {
    let nameChanged = false;
    let changedDependents: Dependent[] = [];
    //何が変更されているか確認
    if (this.marriageForm.get('name')?.value !== this.employee?.firstName) {
      nameChanged = true;
    }
    for (let dependent of this.marriageDependents.controls) {
      const beforeDependent = this.dependents.find(d => d.dependentId === dependent.value.dependentId);
      if (beforeDependent && (dependent.get('name')?.value !== beforeDependent.name || dependent.get('relationship')?.value !== beforeDependent.relationship || dependent.get('birthDate')?.value !== beforeDependent.birthDate)) {
        changedDependents.push(dependent.value);
      } else if (!beforeDependent && (dependent.get('name')?.value !== '' || dependent.get('relationship')?.value !== '' || dependent.get('birthDate')?.value !== '')) {
        changedDependents.push(dependent.value);
      }
    }
    //それぞれイベントを作成（名前、扶養分けて）（ペイロードに変更内容を入れる）
    //名前変更イベントを作成
    if (nameChanged) {
      const nameEvent: Partial<Event> = {
        //IDはサービスで作る（氏名変更_YYYY_MM_01、YYYYMMは発生日の年月、01は連番）
        occurredDate: Timestamp.fromDate(new Date(this.marriageForm.get('occurredDate')!.value)),
        eventType: '氏名変更',
        lifeEventType: this.marriageForm.get('type')?.value as LifeEventType,
        appliedDate: Timestamp.now(),
        applicantType: '社員',
        approval: {
          approvalStatus: '申請中',
        },
        payload: {
          before: this.employee?.firstName ?? '',
          after: this.marriageForm.get('name')?.value ?? '',
        },
      };
      const nameResult = await this.eventService.createEvent(this.loginEmployeeId, nameEvent);
      //名前変更が失敗した場合は最初から再申請
      if (!nameResult) {
        this.commonService.showTimedMessage(CREATE_MESSAGES.FAILED, value => this.message = value, this.MessageTimer);
        return;
      }
    }

    if (changedDependents.length > 0) {
      await this.createDependentEvent(changedDependents);
    }

    this.marriageForm.reset();
    this.marriageDependents.clear();

    this.marriageForm.patchValue({
      name: this.employee?.firstName ?? '',
      dependents: this.dependents.map(dependent => this.createDependentForm().patchValue(dependent)),
    });

    return;
  }


  birthForm = this.fb.nonNullable.group({
    type: ['出産' as '出産' | '育児', [Validators.required]],
    leaveTypes: ['産前産後' as '産前産後' | '育児' | 'なし', [Validators.required]],
    resignationDate: ['', [Validators.required]],
    childBirthDate: ['', [Validators.required]],
    dependents: this.fb.array<FormGroup>([]),
  });

  /** 出産/育児申請 */
  submitBirthForm() {
    let leaveTypesChanged = false;
    let dependentsChanged = false;
    //何が変更されているか確認
    //それぞれイベントを作成（休職、扶養分けて）
  }

  nameChangeForm = this.fb.nonNullable.group({
    name: ['', [Validators.required]],
  });

  /** 氏名変更申請 */
  submitNameChangeForm() {
    console.log(this.nameChangeForm.value);
    //変更があるか確認
    if (this.nameChangeForm.get('name')?.value === this.employee?.firstName) {
      return;
    }
    //イベントを作成（名前）
  }


  dependentChangeForm = this.fb.nonNullable.group({
    dependents: this.fb.array<FormGroup>([]),
  });

  /** 扶養変更申請 */
  submitDependentChangeForm() {
    console.log(this.dependentChangeForm.value);
    let changedDependents: Dependent[] = [];
    //変更されているか確認
    //イベントを作成（扶養一人ずつ分けて）
  }




  /** 扶養追加 */
  private createDependentForm(): FormGroup {
    return this.fb.nonNullable.group({
      name: ['', [Validators.required]],
      relationship: ['', [Validators.required]],
      birthDate: ['', [Validators.required, this.validationService.birthDateValidator]],
      isDependent: [true],
    });
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

  addDependent(type: number) {
    const dependent = this.createDependentForm();
    switch (type) {
      case 1:
        this.marriageDependents.push(dependent);
        break;
      case 2:
        this.birthDependents.push(dependent);
        break;
      case 3:
        this.dependentChangeDependents.push(dependent);
        break;
    }
  }

  private async createDependentEvent(changedDependents: Dependent[]) {
    let successCount = 0;
    let failedCount = 0;
    //扶養情報変更イベントを作成
    for (let dependent of changedDependents) {
      const beforeDependent: Dependent | undefined = this.dependents.find(d => d.dependentId === dependent.dependentId);
      if (!beforeDependent || (beforeDependent && (dependent.name !== beforeDependent.name || dependent.relationship !== beforeDependent.relationship || dependent.birthDate !== beforeDependent.birthDate))) {
        const dependentEvent: Partial<Event> = {
          occurredDate: Timestamp.fromDate(new Date(this.marriageForm.get('occurredDate')!.value)),
          eventType: '扶養情報変更',
          lifeEventType: this.marriageForm.get('type')?.value as LifeEventType,
          appliedDate: Timestamp.now(),
          applicantType: '社員',
          approval: {
            approvalStatus: '申請中',
          },
          payload: {
            before: beforeDependent ? beforeDependent : null,
            after: dependent,
          },
        };
        const dependentResult = await this.eventService.createEvent(this.loginEmployeeId, dependentEvent);
        if (!dependentResult) {
          this.commonService.showTimedMessage(`扶養情報変更申請を${CREATE_MESSAGES.FAILED}`, value => this.message = value, this.MessageTimer);
          failedCount++;
          continue;
        }
        successCount++;
      }
    }
    if (failedCount > 0) {
      this.commonService.showTimedMessage(`申請一覧から申請内容を確認して、再度申請してください`, value => this.message = value, this.MessageTimer);
    }
    this.commonService.showTimedMessage(`${successCount}件の申請を${CREATE_MESSAGES.SUCCESS}`, value => this.message = value, this.MessageTimer);
  }


}
