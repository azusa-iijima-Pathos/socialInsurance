import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MyInsuranceDetail } from './my-insurance-detail';

describe('MyInsuranceDetail', () => {
  let component: MyInsuranceDetail;
  let fixture: ComponentFixture<MyInsuranceDetail>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MyInsuranceDetail]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MyInsuranceDetail);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
