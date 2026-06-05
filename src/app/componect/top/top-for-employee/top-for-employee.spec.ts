import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TopForEmployee } from './top-for-employee';

describe('TopForEmployee', () => {
  let component: TopForEmployee;
  let fixture: ComponentFixture<TopForEmployee>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TopForEmployee]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TopForEmployee);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
