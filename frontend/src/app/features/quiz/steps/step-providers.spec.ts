import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { StreamingProvider } from '../../../core/models/quiz';
import { QuizOptionsService } from '../../../core/services/quiz-options.service';
import { StepProviders } from './step-providers';

const REGION_PROVIDERS: StreamingProvider[] = [
  { id: 'netflix', displayName: 'Netflix', regions: ['GLOBAL'] },
  { id: 'globoplay', displayName: 'Globoplay', regions: ['BR'] },
];

const FALLBACK: StreamingProvider[] = [
  { id: 'fallback-netflix', displayName: 'Popular Default', regions: ['GLOBAL'] },
];

const OFFLINE = () => new Error('offline');

describe('step 3 providers (FR-013)', () => {
  function setup(load: () => Observable<StreamingProvider[]>): ComponentFixture<StepProviders> {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: QuizOptionsService,
          useValue: {
            loadProviders: vi.fn(load),
            getFallbackProviders: vi.fn(() => FALLBACK),
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(StepProviders);
    fixture.componentRef.setInput('choice', { values: [], any: false });
    fixture.componentRef.setInput('includeUnownedProviders', false);
    fixture.detectChanges();
    return fixture;
  }

  function text(fixture: ComponentFixture<StepProviders>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function retryButton(fixture: ComponentFixture<StepProviders>): HTMLButtonElement {
    return (fixture.nativeElement as HTMLElement).querySelector('button')!;
  }

  it('offers the region list once the load succeeds', () => {
    const fixture = setup(() => of(REGION_PROVIDERS));

    expect(text(fixture)).toContain('Netflix');
    expect(text(fixture)).toContain('Globoplay');
    expect(text(fixture)).not.toContain('default list');
  });

  it('offers a Retry action when the load fails — never a dead end', () => {
    const fixture = setup(() => throwError(OFFLINE));

    expect(text(fixture)).toContain("couldn't load the streaming services");
    expect(retryButton(fixture).textContent?.trim()).toBe('Retry');
  });

  it('falls back to a default list with a notice when the retry also fails', () => {
    const fixture = setup(() => throwError(OFFLINE));

    retryButton(fixture).click();
    fixture.detectChanges();

    expect(text(fixture)).toContain('Popular Default');
    expect(text(fixture)).toContain('Showing a default list of popular services');
  });

  it('lets the visitor keep choosing after falling back, so the quiz completes', () => {
    const fixture = setup(() => throwError(OFFLINE));

    retryButton(fixture).click();
    fixture.detectChanges();

    // The choice chips render in the fallback state too.
    const chips = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'app-choice-chips button',
    );
    expect(chips.length).toBeGreaterThan(0);
    expect(text(fixture)).toContain('Show content on other platforms');
  });

  it('shows a progress state while the list is loading', () => {
    const pending = new Observable<StreamingProvider[]>(() => undefined);
    const fixture = setup(() => pending);

    expect(text(fixture)).toContain('Loading streaming services');
    expect(retryButton(fixture)).toBeNull();
  });
});
