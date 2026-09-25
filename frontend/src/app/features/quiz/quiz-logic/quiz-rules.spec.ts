import { MediaType, QuizState } from '../../../core/models/quiz';
import {
  canAdvance,
  completeQuiz,
  createInitialQuizState,
  emptyChoice,
  goToNextStep,
  goToPreviousStep,
  isStepComplete,
  startRetake,
  toPreference,
  toggleAny,
  toggleValue,
  withUnownedProviders,
} from './quiz-rules';

const T0 = '2026-09-25T10:00:00.000Z';
const T1 = '2026-09-25T10:05:00.000Z';

describe('quiz-rules', () => {
  describe('isStepComplete (FR-005)', () => {
    it('rejects a step with nothing selected', () => {
      expect(isStepComplete(emptyChoice<string>())).toBe(false);
    });

    it('accepts a step with at least one selected value', () => {
      expect(isStepComplete({ values: ['action'], any: false })).toBe(true);
    });

    it('accepts the "Any / No preference" chip on its own', () => {
      expect(isStepComplete({ values: [], any: true })).toBe(true);
    });
  });

  describe('toggleValue', () => {
    it('adds a value', () => {
      expect(toggleValue(emptyChoice<string>(), 'action')).toEqual({
        values: ['action'],
        any: false,
      });
    });

    it('removes an already selected value', () => {
      const choice = { values: ['action', 'comedy'], any: false };
      expect(toggleValue(choice, 'action')).toEqual({ values: ['comedy'], any: false });
    });

    it('clears an active Any chip, because the chip is exclusive (FR-005)', () => {
      expect(toggleValue({ values: [], any: true }, 'horror')).toEqual({
        values: ['horror'],
        any: false,
      });
    });
  });

  describe('toggleAny', () => {
    it('selects the chip and clears any values', () => {
      expect(toggleAny({ values: ['action'], any: false })).toEqual({ values: [], any: true });
    });

    it('deselects the chip when tapped again', () => {
      expect(toggleAny({ values: [], any: true })).toEqual({ values: [], any: false });
    });
  });

  describe('createInitialQuizState', () => {
    it('starts a first-time visitor on step 1 with nothing selected', () => {
      const state = createInitialQuizState(T0);

      expect(state.schemaVersion).toBe(1);
      expect(state.status).toBe('in-progress');
      expect(state.step).toBe(1);
      expect(state.mediaType.values).toEqual([]);
      expect(state.genre.values).toEqual([]);
      expect(state.provider.values).toEqual([]);
      expect(state.includeUnownedProviders).toBe(false); // FR-006 default
      expect(state.updatedAt).toBe(T0);
      expect(state.completedAt).toBeUndefined();
    });
  });

  describe('step navigation', () => {
    const answered = (): QuizState => ({
      ...createInitialQuizState(T0),
      mediaType: { values: ['movie'], any: false },
    });

    it('cannot advance while the current step is unanswered (FR-005)', () => {
      expect(canAdvance(createInitialQuizState(T0))).toBe(false);
    });

    it('can advance once the current step is answered', () => {
      expect(canAdvance(answered())).toBe(true);
    });

    it('moves forward and backward through the three steps (FR-001)', () => {
      const step2 = goToNextStep(answered(), T1);
      expect(step2.step).toBe(2);

      const step3 = goToNextStep(step2, T1);
      expect(step3.step).toBe(3);

      expect(goToNextStep(step3, T1).step).toBe(3); // never past the last step
    });

    it('retains every answer when going back (FR-008)', () => {
      const state = goToNextStep(answered(), T1);
      const back = goToPreviousStep(state, T1);

      expect(back.step).toBe(1);
      expect(back.mediaType.values).toEqual(['movie']);
    });

    it('never goes back past the first step', () => {
      expect(goToPreviousStep(createInitialQuizState(T0), T1).step).toBe(1);
    });
  });

  describe('withUnownedProviders', () => {
    it('toggles the "show content on other platforms" flag (FR-006)', () => {
      const state = withUnownedProviders(createInitialQuizState(T0), true, T1);
      expect(state.includeUnownedProviders).toBe(true);
      expect(state.updatedAt).toBe(T1);
    });
  });

  describe('completeQuiz', () => {
    it('marks the quiz completed and stamps completedAt (FR-009)', () => {
      const completed = completeQuiz(createInitialQuizState(T0), T1);

      expect(completed.status).toBe('completed');
      expect(completed.completedAt).toBe(T1);
      expect(completed.updatedAt).toBe(T1);
    });

    it('produces the deck input through toPreference', () => {
      const state: QuizState = {
        ...createInitialQuizState(T0),
        mediaType: { values: ['movie'] as MediaType[], any: false },
        genre: { values: ['horror'], any: false },
        includeUnownedProviders: true,
      };

      expect(toPreference(completeQuiz(state, T1))).toEqual({
        mediaType: { values: ['movie'], any: false },
        genre: { values: ['horror'], any: false },
        provider: { values: [], any: false },
        includeUnownedProviders: true,
        completedAt: T1,
      });
    });

    it('has no deck input while the quiz is still in progress', () => {
      expect(toPreference(createInitialQuizState(T0))).toBeNull();
    });
  });

  describe('startRetake (FR-012)', () => {
    it('reopens the quiz at step 1 with the previous answers pre-filled', () => {
      const completed = completeQuiz(
        {
          ...createInitialQuizState(T0),
          step: 3,
          mediaType: { values: ['anime'], any: false },
        },
        T1,
      );

      const retake = startRetake(completed, T1);

      expect(retake.status).toBe('in-progress');
      expect(retake.step).toBe(1);
      expect(retake.mediaType.values).toEqual(['anime']);
      expect('completedAt' in retake).toBe(false);
    });
  });
});
