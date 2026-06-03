import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AddInsuranceCsv } from './add-insurance-csv';

describe('AddInsuranceCsv', () => {
  let component: AddInsuranceCsv;
  let fixture: ComponentFixture<AddInsuranceCsv>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddInsuranceCsv]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AddInsuranceCsv);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
