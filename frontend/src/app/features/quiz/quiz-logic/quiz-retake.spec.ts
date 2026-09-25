import { QuizState } from '../../../core/models/quiz';
import {
  canAdvance,
  completeQuiz,
  createInitialQuizState,
  startRetake,
  withChoice,
} from './quiz-rules';

const T0 = '2026-09-25T10:00:00.000Z';
const T1 = '2026-09-25T10:05:00.000Z';
const T2 = '2026-09-25T10:10:00.000Z';

/** A completed quiz with a couple of answers, as a returning visitor would have. */
function completedQuiz(): QuizState {
  const answered = withChoice(
    createInitialQuizState(T0),
    'mediaType',
    { values: ['movie'], any: false },
    T0,
  );
  const withGenres = withChoice(answered, 'genre', { values: ['horror'], any: false }, T0);
  return completeQuiz(withGenres, T1);
}

describe('quiz retake (FR-012, US3)', () => {
  it('reopens at step 1 with the previous answers pre-filled', () => {
    const retake = startRetake(completedQuiz(), T2);

    expect(retake.step).toBe(1);
    expect(retake.status).toBe('in-progress');
    expect(retake.mediaType.values).toEqual(['movie']);
    expect(retake.genre.values).toEqual(['horror']);
  });

  it('clears the completion stamp so the quiz counts as unfinished again', () => {
    const retake = startRetake(completedQuiz(), T2);

    expect('completedAt' in retake).toBe(false);
    expect(retake.updatedAt).toBe(T2);
  });

  it('lets the visitor continue immediately, since the answers are pre-filled', () => {
    expect(canAdvance(startRetake(completedQuiz(), T2))).toBe(true);
  });

  it('replaces the saved answers when the retake completes (US3 scenario 3)', () => {
    const retake = startRetake(completedQuiz(), T2);
    const changed = withChoice(retake, 'genre', { values: ['comedy'], any: false }, T2);
    const recompleted = completeQuiz(changed, T2);

    expect(recompleted.genre.values).toEqual(['comedy']);
    expect(recompleted.status).toBe('completed');
    expect(recompleted.completedAt).toBe(T2);
    // The document is replaced wholesale — no trace of the previous genre.
    expect(recompleted.genre.values).not.toContain('horror');
  });
});
