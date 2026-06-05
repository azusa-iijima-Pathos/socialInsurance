import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OfficeService } from '../../../service/Firestore/office-service';
import { Office } from '../../../model/office';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { PREFECTURES, Prefecture } from '../../../constants/model-constants';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { UPDATE_MESSAGES } from '../../../constants/constants';

@Component({
  selector: 'app-office-list',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './office-list.html',
  styleUrl: './office-list.css',
})
export class OfficeList {

  private officeService = inject(OfficeService);
  commonService = inject(CommonService);

  permission = sessionStorage.getItem('permission') ?? '';

  allOffices = this.officeService.allOffices;

  PREFECTURES = PREFECTURES;

  message: string = '';
  private messageTimer: MessageTimer = null;

  async ngOnInit() {
    //全事業所を取得
    await this.officeService.getAllOffice();
  }

  /** 事業所を削除 */
  async deleteOffice(office: Office) {
    const officeName = office.name;
    const result = await this.officeService.deleteOffice(office);
    if (!result.success) {
      this.commonService.showTimedMessage(result.message, value => this.message = value, this.messageTimer);
      return;
    }
    this.commonService.showTimedMessage(`${officeName}を${result.message}`, value => this.message = value, this.messageTimer);
    await this.officeService.getAllOffice(true);
    return;
  }


  private fb = inject(FormBuilder);

  form = this.fb.group({
    name: ['', [Validators.required]],
    prefecture: ['', [Validators.required]],
  });

  isOpenModal: boolean = false;
  selectedOfficeId: string = '';
  editOffice(office: Office) {
    this.form.patchValue({
      name: office.name,
      prefecture: office.prefecture,
    });
    this.selectedOfficeId = office.officeId;
    this.isOpenModal = true;
  }

  closeModal() {
    this.isOpenModal = false;
    this.selectedOfficeId = '';
    this.form.reset();
  }

  /** 事業所を更新 */
  async submitForm() {
    console.log("submitForm");
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const confirm = window.confirm('事業所情報を変更した場合、保険料自動計算結果が即時変更されます。\n確認の上、「OK」ボタンをクリックしてください。');
    if (!confirm) {
      this.closeModal();
      return;
    }

    const office: Partial<Office> = {
      officeId: this.selectedOfficeId,
      name: this.form.value.name!,
      prefecture: this.form.value.prefecture! as Prefecture,
    };
    const result = await this.officeService.updateOffice(office);
    if (!result) {
      this.commonService.showTimedMessage(UPDATE_MESSAGES.FAILED, value => this.message = value, this.messageTimer);
      return;
    }
    this.commonService.showTimedMessage(UPDATE_MESSAGES.SUCCESS, value => this.message = value, this.messageTimer);
    await this.officeService.getAllOffice(true);
    this.closeModal();
    return;
  }
}
