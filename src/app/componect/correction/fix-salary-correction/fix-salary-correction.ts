import { Component } from '@angular/core';

/**
 * 固定給修正
 * 
 * 固定給変更適用日を入力してもらい、その作業月の3か月後に随時改定イベントを作成（3か月前の場合は自分で差額調整してもらう）
固定給更新も行う。
イベントとシステム計算結果
 */
@Component({
  selector: 'app-fix-salary-correction',
  imports: [],
  templateUrl: './fix-salary-correction.html',
  styleUrl: './fix-salary-correction.css',
})
export class FixSalaryCorrection {

}
