import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CompanyService } from '../../../../service/Firestore/company-service';
import { Company } from '../../../../model/company';

/**
 * 会社情報初期登録直後の確認画面
 */

@Component({
  selector: 'app-company-confirm',
  imports: [CommonModule],
  templateUrl: './company-confirm.html',
  styleUrl: './company-confirm.css',
})
export class CompanyConfirm {

  private router = inject(Router);
  private companyService = inject(CompanyService);

  companyId = sessionStorage.getItem('companyId');
  company: Company | null = null;

  async ngOnInit() {
    
    if (!this.companyId) {
      this.router.navigate(['/login']);
    }else{
      this.company = await this.companyService.getOneCompany(this.companyId);
      if (!this.company) {
        this.router.navigate(['/login']);
      }
    } 
    
    //権限確認？

    
  }

  /** 事業所情報初期登録へ進む */
  toOfficeForm() {
    this.router.navigate([`/initial-setting/${this.companyId}/office-form`]);
  }

}
