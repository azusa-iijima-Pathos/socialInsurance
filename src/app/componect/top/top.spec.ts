import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Top } from './topForManage';

describe('Top', () => {
  let component: Top;
  let fixture: ComponentFixture<Top>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Top]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Top);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
