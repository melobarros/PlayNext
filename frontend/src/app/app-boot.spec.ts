import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { vi } from 'vitest';
import { Entry, resolveEntryPath } from './app-boot';
import { QuizState } from './core/models/quiz';
import { PreferenceStore } from './core/services/preference-store';
import { BootResult, SessionBoot } from './core/services/session-boot';
import { completeQuiz, createInitialQuizState } from './features/quiz/quiz-logic/quiz-rules';

const T0 = '2026-09-25T10:00:00.000Z';

describe('app boot decision (FR-011)', () => {
  describe('resolveEntryPath', () => {
    it('sends a first-time visitor to the quiz', () => {
      expect(resolveEntryPath(null)).toBe('/quiz');
    });

    it('resumes an unfinished quiz rather than restarting it', () => {
      expect(resolveEntryPath(createInitialQuizState(T0))).toBe('/quiz');
    });

    it('sends a returning visitor who finished the quiz straight to the deck', () => {
      const completed: QuizState = completeQuiz(createInitialQuizState(T0), T0);
      expect(resolveEntryPath(completed)).toBe('/deck');
    });
  });

  describe('Entry', () => {
    /**
     * `read` is a function rather than a value because that is what the real
     * store is: boot can change what it returns, and one of these tests is
     * about exactly that.
     */
    function setup(
      read: () => QuizState | null,
      boot: () => Observable<BootResult> = () => of({ state: 'guest' }),
    ) {
      const navigateByUrl = vi.fn().mockResolvedValue(true);

      TestBed.configureTestingModule({
        providers: [
          { provide: PreferenceStore, useValue: { read } },
          { provide: SessionBoot, useValue: { restore: boot } },
          { provide: Router, useValue: { navigateByUrl } },
        ],
      });

      return { navigateByUrl, fixture: TestBed.createComponent(Entry) };
    }

    it('forwards a new visitor to the quiz', () => {
      const { navigateByUrl, fixture } = setup(() => null);
      fixture.detectChanges();

      expect(navigateByUrl).toHaveBeenCalledWith('/quiz', { replaceUrl: true });
    });

    it('forwards a visitor with a finished quiz to the deck', () => {
      const { navigateByUrl, fixture } = setup(() => completeQuiz(createInitialQuizState(T0), T0));
      fixture.detectChanges();

      expect(navigateByUrl).toHaveBeenCalledWith('/deck', { replaceUrl: true });
    });

    it('decides the route from what the restore left behind, not what was there before', () => {
      // The device has no quiz on it; the account does. This is the new-device
      // case, and the whole reason the restore is awaited: routing first would
      // send the visitor through a quiz they finished months ago on the way to
      // the deck they were already entitled to.
      let cached: QuizState | null = null;

      const { navigateByUrl, fixture } = setup(
        () => cached,
        () => {
          cached = completeQuiz(createInitialQuizState(T0), T0);
          return of({ state: 'restored' as const });
        },
      );

      fixture.detectChanges();

      expect(navigateByUrl).toHaveBeenCalledWith('/deck', { replaceUrl: true });
    });

    it('does not route until the restore has finished', () => {
      const { navigateByUrl, fixture } = setup(
        () => null,
        () => new Observable<BootResult>(),
      );

      fixture.detectChanges();

      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('routes once the restore reports an expired session', () => {
      // An expired session is a landing decision like any other: the visitor
      // is a guest now, and their cached quiz state decides where they go.
      const { navigateByUrl, fixture } = setup(
        () => completeQuiz(createInitialQuizState(T0), T0),
        () => of({ state: 'expired' as const }),
      );

      fixture.detectChanges();

      expect(navigateByUrl).toHaveBeenCalledWith('/deck', { replaceUrl: true });
    });
  });
});
