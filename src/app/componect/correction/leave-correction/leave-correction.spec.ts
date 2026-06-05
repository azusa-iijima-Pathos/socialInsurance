import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LeaveCorrection } from './leave-correction';

describe('LeaveCorrection', () => {
  let component: LeaveCorrection;
  let fixture: ComponentFixture<LeaveCorrection>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LeaveCorrection]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LeaveCorrection);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
