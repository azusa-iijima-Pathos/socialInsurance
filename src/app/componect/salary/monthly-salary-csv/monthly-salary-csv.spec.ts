import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MonthlySalaryCSV } from './monthly-salary-csv';

describe('MonthlySalaryCSV', () => {
  let component: MonthlySalaryCSV;
  let fixture: ComponentFixture<MonthlySalaryCSV>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MonthlySalaryCSV]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MonthlySalaryCSV);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
