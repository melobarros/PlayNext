import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { INTERACTION_STORAGE_KEY } from '../../../core/models/interaction';
import { QuizState } from '../../../core/models/quiz';
import { InteractionStore } from '../../../core/services/interaction-store';
import { PreferenceStore } from '../../../core/services/preference-store';
import { DeckOutcome, EmptyState } from './empty-state';

/**
 * The deck with nothing to show (FR-014, US4).
 *
 * This is the surface that makes "never a dead end" (constitution II) true at
 * the exact moment the deck runs out — which is also the moment a visitor is
 * most likely to give up. So the tests are about what is *offered*, not just
 * what is written: an explanation with no action would satisfy a copy check and
 * still strand them.
 *
 * The reset is tested through the real `PreferenceStore` rather than a spy.
 * What matters is not that some method was called, but that the quiz document
 * left behind is one spec 001's own `isValidQuizState` accepts, that it still
 * carries the previous answers (the visitor is meant to *widen* their
 * selections, not start over), and that it no longer claims to be completed —
 * so `/quiz` really does reopen.
 */

@Component({ selector: 'app-blank', template: '' })
class Blank {}

const COMPLETED_AT = '2026-09-26T10:00:00.000Z';

/** A finished quiz, answered Movie + Horror + Netflix. */
function completedQuiz(overrides: Partial<QuizState> = {}): QuizState {
  return {
    schemaVersion: 1,
    status: 'completed',
    step: 3,
    mediaType: { values: ['movie'], any: false },
    genre: { values: ['horror'], any: false },
    provider: { values: ['netflix'], any: false },
    includeUnownedProviders: false,
    completedAt: COMPLETED_AT,
    updatedAt: COMPLETED_AT,
    ...overrides,
  };
}

describe('the deck with nothing to show (FR-014, US4)', () => {
  let fixture: ComponentFixture<EmptyState>;
  let root: HTMLElement;

  function build(outcome: DeckOutcome): void {
    fixture = TestBed.createComponent(EmptyState);
    fixture.componentRef.setInput('outcome', outcome);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  function text(): string {
    return root.textContent ?? '';
  }

  function button(label: string): HTMLButtonElement | undefined {
    return [...root.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
  }

  function tap(label: string): void {
    const target = button(label);
    if (!target) throw new Error(`No button labelled "${label}"`);
    target.click();
    fixture.detectChanges();
  }

  /** The raw interactions document, as another feature would find it. */
  function savedInteractions(): string | null {
    return localStorage.getItem(INTERACTION_STORAGE_KEY);
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      // Both routes are stubbed: an unmatched URL must not be the reason a
      // navigation assertion passes or fails.
      providers: [
        provideRouter([
          { path: '', component: Blank },
          { path: 'quiz', component: Blank },
        ]),
      ],
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('when nothing matches the filters (US4 scenario 2)', () => {
    it('says why, rather than showing a spinner that never resolves (FR-014)', () => {
      build('no-matches');

      // `role="progressbar"` is this codebase's spinner (quiz.html). The spec's
      // edge case is explicit that an emptied deck must never leave one
      // turning: waiting is not an option the visitor can act on.
      expect(root.querySelector('[role="progressbar"]')).toBeNull();
      expect(text()).toContain('Nothing matches');
    });

    it('offers the 1-click Reset Filters action (FR-014)', () => {
      build('no-matches');

      expect(button('Reset Filters')).toBeDefined();
    });

    it('does not offer a new loop, which would land on this same screen', () => {
      // Nothing matches, so re-walking the deck is instant and lands back
      // here. Offering it would be a dead end dressed as an action.
      build('no-matches');

      expect(button('Start a new loop')).toBeUndefined();
    });
  });

  describe('when every title has been rated or rejected (spec Edge Cases)', () => {
    it('offers the reset action here too', () => {
      // This visitor's filters are not the problem — they have simply seen
      // everything that matches them. Widening is still the way out.
      build('exhausted');

      expect(button('Reset Filters')).toBeDefined();
    });

    it('still offers the new loop, because there is a deck to walk again', () => {
      build('exhausted');

      expect(button('Start a new loop')).toBeDefined();
    });

    it('asks the shell to start it, which is the only place the loop can restart', () => {
      // This component cannot do it: the running loop lives in the shell's
      // signal, and re-entering `/deck` would not rebuild the shell.
      const started = vi.fn();
      build('exhausted');
      fixture.componentInstance.startNewLoop.subscribe(started);

      tap('Start a new loop');

      expect(started).toHaveBeenCalled();
    });
  });

  describe('when the quiz has not been taken', () => {
    it('sends the visitor to the quiz, and offers no reset', () => {
      // There is nothing to reset — no answers have been given. A Reset
      // Filters button here would write a retake over a document that does
      // not exist.
      build('needs-quiz');

      expect(button('Reset Filters')).toBeUndefined();
      expect(root.querySelector('a[href="/quiz"]')).not.toBeNull();
    });
  });

  describe('Reset Filters (US4 scenario 3, research.md D9)', () => {
    beforeEach(() => {
      TestBed.inject(PreferenceStore).write(completedQuiz());
    });

    it('reopens the quiz at the beginning, no longer completed', () => {
      build('no-matches');

      tap('Reset Filters');

      const reopened = TestBed.inject(PreferenceStore).read();
      expect(reopened?.status).toBe('in-progress');
      expect(reopened?.step).toBe(1);
      // `toPreference` gates on this: while it is set, the deck would keep
      // treating the retake as finished and never show the quiz.
      expect(reopened?.completedAt).toBeUndefined();
    });

    it('keeps every answer, so the visitor widens rather than starts over', () => {
      build('no-matches');

      tap('Reset Filters');

      const reopened = TestBed.inject(PreferenceStore).read();
      expect(reopened?.mediaType).toEqual({ values: ['movie'], any: false });
      expect(reopened?.genre).toEqual({ values: ['horror'], any: false });
      expect(reopened?.provider).toEqual({ values: ['netflix'], any: false });
    });

    it('hands the visitor to the quiz (FR-014)', () => {
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      build('no-matches');
      tap('Reset Filters');

      expect(navigate).toHaveBeenCalledWith(['/quiz']);
    });

    it('leaves the visitor’s exclusions exactly where they were (FR-009)', () => {
      // The reset widens the *filters*. It must not resurrect a title the
      // visitor rejected — those live in the interaction document, and D9's
      // whole point is that the retake cannot reach them.
      const interactions = TestBed.inject(InteractionStore);
      interactions.record('rejected-title', 'disliked');
      interactions.record('boring-title', 'notInterested');
      const before = savedInteractions();

      build('no-matches');
      tap('Reset Filters');

      expect(savedInteractions()).toBe(before);
      expect(TestBed.inject(InteractionStore).read().interactions['rejected-title']?.state).toBe(
        'disliked',
      );
    });
  });
});
