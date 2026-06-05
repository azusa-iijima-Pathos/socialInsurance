import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OfficeList } from '../office-list/office-list';
import { OfficeService } from '../../../service/Firestore/office-service';
import { FormBuilder, Validators, ReactiveFormsModule} from '@angular/forms';
import { CommonService, MessageTimer } from '../../../service/common/common-service';
import { Office } from '../../../model/office';
import { Prefecture, PREFECTURES } from '../../../constants/model-constants';
import { CREATE_MESSAGES } from '../../../constants/constants';

@Component({
  selector: 'app-office-detail',
  imports: [CommonModule,OfficeList, ReactiveFormsModule],
  templateUrl: './office-detail.html',
  styleUrl: './office-detail.css',
})
export class OfficeDetail {

private officeService = inject(OfficeService);
private fb = inject(FormBuilder);
commonService = inject(CommonService);

permission = sessionStorage.getItem('permission') ?? '';

PREFECTURES = PREFECTURES;

form = this.fb.group({
  name: ['', [Validators.required]],
  prefecture: ['', [Validators.required]],
});

message: string = '';
messageTimer: MessageTimer = null;

async registerOffice() {
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
    this.commonService.showTimedMessage(CREATE_MESSAGES.FAILED, value => this.message = value, this.messageTimer);
    return;
  }
  this.commonService.showTimedMessage(CREATE_MESSAGES.SUCCESS, value => this.message = value, this.messageTimer);
  await this.officeService.getAllOffice(true);
  this.form.reset();
}

}
