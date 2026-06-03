import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AddInsuranceInfo } from './add-insurance-info';

describe('AddInsuranceInfo', () => {
  let component: AddInsuranceInfo;
  let fixture: ComponentFixture<AddInsuranceInfo>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddInsuranceInfo]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AddInsuranceInfo);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
