import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OfficeService } from '../../../service/Firestore/office-service';
import { Office } from '../../../model/office';
import { CommonService, MessageTimer } from '../../../service/common/common-service';

@Component({
  selector: 'app-office-list',
  imports: [CommonModule],
  templateUrl: './office-list.html',
  styleUrl: './office-list.css',
})
export class OfficeList {

  private officeService = inject(OfficeService);
  commonService = inject(CommonService);

  allOffices = this.officeService.allOffices;

  deleteMessage: string = '';
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
      this.commonService.showTimedMessage(result.message, value => this.deleteMessage = value, this.messageTimer);
      return;
    }
    this.commonService.showTimedMessage(`${officeName}を${result.message}`, value => this.deleteMessage = value, this.messageTimer);
    await this.officeService.getAllOffice(true);
    return;
  }

  // private showMessage(message: string) {
  //   this.messageTimer = this.commonService.showTimedMessage(message, value => this.deleteMessage = value, this.messageTimer);
  // }

}
