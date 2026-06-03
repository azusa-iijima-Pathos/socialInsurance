import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PermissionSetting } from './permission-setting';

describe('PermissionSetting', () => {
  let component: PermissionSetting;
  let fixture: ComponentFixture<PermissionSetting>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PermissionSetting]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PermissionSetting);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
