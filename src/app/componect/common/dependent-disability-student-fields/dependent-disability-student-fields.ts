import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  DISABILITY_STATUSES,
  DISABILITY_TYPES,
  STUDENT_STATUSES,
  STUDENT_TYPES,
} from '../../../constants/model-constants';

@Component({
  selector: 'app-dependent-disability-student-fields',
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <ng-container [formGroup]="group">
      <div class="im-field-block im-field-row employee-edit-field employee-edit-field--wide">
        <div class="im-field-row__label"><span>障害</span></div>
        <div class="im-field-row__control">
          <div class="im-radio-group">
            <label class="im-radio-option" *ngFor="let status of DISABILITY_STATUSES">
              <input type="radio" formControlName="disabilityStatus" [value]="status">
              <span>{{ status }}</span>
            </label>
          </div>
        </div>
      </div>

      <div class="im-field-block im-field-row employee-edit-field employee-edit-field--wide"
        *ngIf="group.get('disabilityStatus')?.value === 'あり'">
        <div class="im-field-row__label">
          <label [for]="idPrefix + 'DisabilityType'">障害タイプ</label>
        </div>
        <div class="im-field-row__control">
          <select [id]="idPrefix + 'DisabilityType'" formControlName="disabilityType">
            <option value="">選択してください</option>
            <option *ngFor="let type of DISABILITY_TYPES" [value]="type">{{ type }}</option>
          </select>
          <div class="error">
            <p *ngIf="group.get('disabilityType')?.errors?.['required'] && group.get('disabilityType')?.touched">
              障害タイプは必須です
            </p>
          </div>
        </div>
      </div>

      <div class="im-field-block im-field-row employee-edit-field employee-edit-field--wide">
        <div class="im-field-row__label"><span>学生</span></div>
        <div class="im-field-row__control">
          <div class="im-radio-group">
            <label class="im-radio-option" *ngFor="let status of STUDENT_STATUSES">
              <input type="radio" formControlName="studentStatus" [value]="status">
              <span>{{ status }}</span>
            </label>
          </div>
        </div>
      </div>

      <div class="im-field-block im-field-row employee-edit-field employee-edit-field--wide"
        *ngIf="group.get('studentStatus')?.value === '学生'">
        <div class="im-field-row__label">
          <label [for]="idPrefix + 'StudentType'">学生タイプ</label>
        </div>
        <div class="im-field-row__control">
          <select [id]="idPrefix + 'StudentType'" formControlName="studentType">
            <option value="">選択してください</option>
            <option *ngFor="let type of STUDENT_TYPES" [value]="type">{{ type }}</option>
          </select>
          <div class="error">
            <p *ngIf="group.get('studentType')?.errors?.['required'] && group.get('studentType')?.touched">
              学生タイプは必須です
            </p>
          </div>
        </div>
      </div>
    </ng-container>
  `,
})
export class DependentDisabilityStudentFields {

  @Input({ required: true }) group!: FormGroup;
  @Input() idPrefix = 'dependent';

  DISABILITY_STATUSES = DISABILITY_STATUSES;
  DISABILITY_TYPES = DISABILITY_TYPES;
  STUDENT_STATUSES = STUDENT_STATUSES;
  STUDENT_TYPES = STUDENT_TYPES;
}
