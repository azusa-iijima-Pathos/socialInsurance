import { Component } from '@angular/core';

/**
 * 保険料修正
 * 
 * 保険情報変更（遡及修正）
適用日を入力してもらう。その日がどの作業月かを確認し、
その作業月から現在の確定済みの保険料との差額をそれぞれの月で算出
保険情報更新も行う。
システム計算結果作成
 * 
 * 
 */
@Component({
  selector: 'app-insurance-correction',
  imports: [],
  templateUrl: './insurance-correction.html',
  styleUrl: './insurance-correction.css',
})
export class InsuranceCorrection {

}
