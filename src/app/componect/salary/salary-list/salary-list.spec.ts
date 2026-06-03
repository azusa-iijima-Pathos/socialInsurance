import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MonthlySalaryList } from './salary-list';

describe('MonthlySalaryList', () => {
  let component: MonthlySalaryList;
  let fixture: ComponentFixture<MonthlySalaryList>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MonthlySalaryList]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MonthlySalaryList);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
