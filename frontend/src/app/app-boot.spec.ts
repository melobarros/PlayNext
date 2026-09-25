import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { Entry, resolveEntryPath } from './app-boot';
import { QuizState } from './core/models/quiz';
import { PreferenceStore } from './core/services/preference-store';
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
    function setup(state: QuizState | null) {
      const navigateByUrl = vi.fn().mockResolvedValue(true);

      TestBed.configureTestingModule({
        providers: [
          { provide: PreferenceStore, useValue: { read: () => state } },
          { provide: Router, useValue: { navigateByUrl } },
        ],
      });

      return { navigateByUrl, fixture: TestBed.createComponent(Entry) };
    }

    it('forwards a new visitor to the quiz', () => {
      const { navigateByUrl, fixture } = setup(null);
      fixture.detectChanges();

      expect(navigateByUrl).toHaveBeenCalledWith('/quiz', { replaceUrl: true });
    });

    it('forwards a visitor with a finished quiz to the deck', () => {
      const { navigateByUrl, fixture } = setup(completeQuiz(createInitialQuizState(T0), T0));
      fixture.detectChanges();

      expect(navigateByUrl).toHaveBeenCalledWith('/deck', { replaceUrl: true });
    });
  });
});
