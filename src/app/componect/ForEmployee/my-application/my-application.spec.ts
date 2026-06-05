import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MyApplication } from './my-application';

describe('MyApplication', () => {
  let component: MyApplication;
  let fixture: ComponentFixture<MyApplication>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MyApplication]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MyApplication);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
