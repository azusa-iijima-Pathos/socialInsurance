import { Component } from '@angular/core';

/**
 * 休暇修正
 * 
 * 産休・育休開始日の変更　実際の開始日と登録済みの開始日を比較し、ずれがある場合は
ずれているタイミングの作業月から現在の確定済みの保険料との差額をそれぞれの月で算出
産休・育休設定も行う。
イベントとシステム計算結果
 */
@Component({
  selector: 'app-leave-correction',
  imports: [],
  templateUrl: './leave-correction.html',
  styleUrl: './leave-correction.css',
})
export class LeaveCorrection {

}
