import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LeaveApplication } from './leave-application';

describe('LeaveApplication', () => {
  let component: LeaveApplication;
  let fixture: ComponentFixture<LeaveApplication>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LeaveApplication]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LeaveApplication);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
