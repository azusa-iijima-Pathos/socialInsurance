import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { OfficeService } from '../../../../service/Firestore/office-service';
import { Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Office } from '../../../../model/office';
import { PREFECTURES, Prefecture } from '../../../../constants/model-constants';
import { CREATE_MESSAGES } from '../../../../constants/constants';
import { ValidationService } from '../../../../service/common/validation-service';
import { OfficeList } from '../../../office/office-list/office-list';
import { CommonService, MessageTimer } from '../../../../service/common/common-service';


@Component({
  selector: 'app-office-form',
  imports: [CommonModule, ReactiveFormsModule, OfficeList],
  templateUrl: './office-form.html',
  styleUrl: './office-form.css',
})
export class OfficeForm {

  private fb = inject(FormBuilder);
  private officeService = inject(OfficeService);
  private router = inject(Router);
  private validationService = inject(ValidationService);
  private commonService = inject(CommonService);

  PREFECTURES = PREFECTURES;

  companyId = sessionStorage.getItem('companyId');

  form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(20)], [this.validationService.validateOfficeName]],
    prefecture: ['', [Validators.required]],
  });

  message: string = '';
  private messageTimer: MessageTimer = null;

  async ngOnInit() {
    //全事業所を取得
    await this.officeService.getAllOffice();
  }

  /** 事業所を登録 */
  async register() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const office: Partial<Office> = {
      name: this.form.value.name!,
      prefecture: this.form.value.prefecture! as Prefecture,
    };
    const result = await this.officeService.registerOffice(office);
    if (!result) {
      this.showMessage(CREATE_MESSAGES.FAILED);
      return;
    }
    this.showMessage(`${this.form.value.name!}を${CREATE_MESSAGES.SUCCESS}`);
    await this.officeService.getAllOffice(true);
    this.form.reset();
    return;
  }

  /** 事業所登録フォームをリセット */
  resetForm() {
    this.form.reset();
    this.clearMessage();
  }

  private showMessage(message: string) {
    this.messageTimer = this.commonService.showTimedMessage(message, value => this.message = value, this.messageTimer);
  }

  private clearMessage() {
    this.messageTimer = this.commonService.clearTimedMessage(value => this.message = value, this.messageTimer);
  }


  /** 社員情報初期登録へ進む */
  toEmployeeForm() {
    this.router.navigate([`/initial-setting/${this.companyId}/employee-form`]);
  }

  /** 登録済み会社情報を再確認する */
  backToCompanyConfirm() {
    this.router.navigate([`/initial-setting/${this.companyId}/company-confirm`]);
  }

}
