import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CorrectionList } from './correction-list';

describe('CorrectionList', () => {
  let component: CorrectionList;
  let fixture: ComponentFixture<CorrectionList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CorrectionList]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CorrectionList);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
