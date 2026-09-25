import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Quiz } from './quiz';
import { QUIZ_STATE_STORAGE_KEY, PreferenceStore } from '../../core/services/preference-store';

/**
 * End-to-end coverage of the quiz shell: the acceptance scenarios a visitor
 * actually walks through, rendered and driven through the DOM.
 */
describe('quiz shell', () => {
  let fixture: ComponentFixture<Quiz>;
  let root: HTMLElement;

  function build(): void {
    fixture = TestBed.createComponent(Quiz);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  function text(): string {
    return root.textContent ?? '';
  }

  /** Clicks the chip or button carrying exactly this label. */
  function tap(label: string, within = ''): void {
    const scope = within ? root.querySelector(within) : root;
    const target = [...(scope?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent?.trim() === label,
    );
    if (!target) throw new Error(`No button labelled "${label}" in "${within || 'quiz'}"`);
    target.click();
    fixture.detectChanges();
  }

  function nextLabel(): string {
    return text().includes('Finish') ? 'Finish' : 'Next';
  }

  function nextDisabled(): boolean {
    const button = [...root.querySelectorAll('footer button')].find(
      (b) => b.textContent?.trim() === nextLabel(),
    );
    return (button as HTMLButtonElement).disabled;
  }

  /** The persisted document, read straight from LocalStorage. */
  function saved(): Record<string, unknown> | null {
    const raw = localStorage.getItem(QUIZ_STATE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('opens a first-time visitor on step 1 with Next unavailable (US1 scenario 1)', () => {
    build();

    expect(text()).toContain('Step 1 of 3');
    expect(text()).toContain('What do you feel like watching?');
    expect(nextDisabled()).toBe(true);
  });

  it('enables Next when only the Any chip is chosen (FR-005)', () => {
    build();

    tap('Any / No preference');

    expect(nextDisabled()).toBe(false);
  });

  it('walks all three steps and lands on the summary (US1, FR-009)', () => {
    build();

    tap('Movie', 'app-step-media-type');
    tap('Next');
    expect(text()).toContain('Step 2 of 3');

    tap('Comedy', 'app-step-genres');
    tap('Next');
    expect(text()).toContain('Step 3 of 3');

    tap('Netflix', 'app-step-providers');
    tap('Finish');

    expect(text()).toContain("You're all set");
    expect(text()).toContain('Start recommendations');
    // Every answer is echoed back on the summary.
    expect(text()).toContain('Movie');
    expect(text()).toContain('Comedy');
    expect(text()).toContain('Netflix');
  });

  it('marks the saved document completed once the quiz finishes (FR-009, SC-004)', () => {
    build();

    tap('Movie', 'app-step-media-type');
    tap('Next');
    tap('Comedy', 'app-step-genres');
    tap('Next');
    tap('Netflix', 'app-step-providers');
    tap('Finish');

    const document = saved();
    expect(document?.['status']).toBe('completed');
    expect(document?.['completedAt']).toBeTruthy();
    expect((document?.['genre'] as { values: string[] }).values).toEqual(['comedy']);
  });

  it('resumes an unfinished quiz at the saved step after a reload (FR-010)', () => {
    build();
    tap('Movie', 'app-step-media-type');
    tap('Next');
    tap('Comedy', 'app-step-genres');

    // A reload is a fresh component reading the same storage.
    build();

    expect(text()).toContain('Step 2 of 3');
    expect(text()).toContain('Comedy');
    expect(nextDisabled()).toBe(false);
  });

  it('skips the quiz entirely when the saved document is already completed (FR-011)', () => {
    build();
    tap('Movie', 'app-step-media-type');
    tap('Next');
    tap('Comedy', 'app-step-genres');
    tap('Next');
    tap('Netflix', 'app-step-providers');
    tap('Finish');

    build();

    expect(text()).toContain("You're all set");
    expect(text()).not.toContain('Step 1 of 3');
  });

  it('retains answers when stepping back (FR-008)', () => {
    build();
    tap('Movie', 'app-step-media-type');
    tap('Next');

    tap('Back');

    expect(text()).toContain('Step 1 of 3');
    const selected = root.querySelector('app-step-media-type button[aria-pressed="true"]');
    expect(selected?.textContent?.trim()).toBe('Movie');
  });

  it('reopens at step 1 with the previous answers still selected on retake (FR-012)', () => {
    build();
    tap('Movie', 'app-step-media-type');
    tap('Next');
    tap('Comedy', 'app-step-genres');
    tap('Next');
    tap('Netflix', 'app-step-providers');
    tap('Finish');

    tap('Start over');

    expect(text()).toContain('Step 1 of 3');
    const selected = root.querySelector('app-step-media-type button[aria-pressed="true"]');
    expect(selected?.textContent?.trim()).toBe('Movie');
    expect(saved()?.['status']).toBe('in-progress');
  });
});
