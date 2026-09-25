import {
  DimensionChoice,
  MediaType,
  Preference,
  QUIZ_STEP_COUNT,
  QuizState,
  QuizStep,
} from '../../../core/models/quiz';
import { QUIZ_STATE_SCHEMA_VERSION } from '../../../core/services/preference-store';

/**
 * The quiz's business rules, as plain functions with no Angular imports.
 *
 * Keeping them framework-free means the critical paths are unit-testable with
 * no DOM and no TestBed (constitution, Principles V and VII) — the same
 * separation the backend will use for its domain layer.
 */

/** Which dimension each step edits (FR-001: fixed order, no language step). */
export const STEP_DIMENSIONS = {
  1: 'mediaType',
  2: 'genre',
  3: 'provider',
} as const satisfies Record<QuizStep, 'mediaType' | 'genre' | 'provider'>;

/** The quiz dimension a step edits. */
export type DimensionKey = (typeof STEP_DIMENSIONS)[QuizStep];

function iso(now: Date | string): string {
  return typeof now === 'string' ? now : now.toISOString();
}

/** An empty dimension: nothing selected, no "Any" chip. */
export function emptyChoice<T extends string>(): DimensionChoice<T> {
  return { values: [], any: false };
}

/**
 * A step is satisfied by at least one selection, or by the explicit
 * "Any / No preference" chip (FR-005).
 */
export function isStepComplete<T extends string>(choice: DimensionChoice<T>): boolean {
  return choice.values.length > 0 || choice.any;
}

/**
 * Toggles a value in a dimension. Choosing a value clears an active "Any"
 * chip, because the chip is exclusive (FR-005).
 */
export function toggleValue<T extends string>(
  choice: DimensionChoice<T>,
  value: T,
): DimensionChoice<T> {
  const values = choice.any ? [] : [...choice.values];
  const index = values.indexOf(value);

  if (index >= 0) {
    values.splice(index, 1);
  } else {
    values.push(value);
  }

  return { values, any: false };
}

/** Toggles the "Any / No preference" chip, clearing any selected values. */
export function toggleAny<T extends string>(choice: DimensionChoice<T>): DimensionChoice<T> {
  return { values: [], any: !choice.any };
}

/** The dimension a step edits, for generic update helpers. */
export function dimensionForStep(step: QuizStep): DimensionKey {
  return STEP_DIMENSIONS[step];
}

/** A brand-new visitor: step 1, nothing selected (FR "quiz starts at step 1"). */
export function createInitialQuizState(now: Date | string = new Date()): QuizState {
  const timestamp = iso(now);
  return {
    schemaVersion: QUIZ_STATE_SCHEMA_VERSION,
    status: 'in-progress',
    step: 1,
    mediaType: emptyChoice<MediaType>(),
    genre: emptyChoice<string>(),
    provider: emptyChoice<string>(),
    includeUnownedProviders: false,
    updatedAt: timestamp,
  };
}

/** The current step's answer. */
export function choiceForStep(
  state: QuizState,
  step: QuizStep,
): DimensionChoice<string> | DimensionChoice<MediaType> {
  return state[dimensionForStep(step)];
}

/** Whether the visitor may leave the current step (FR-005). */
export function canAdvance(state: QuizState): boolean {
  return isStepComplete(choiceForStep(state, state.step));
}

/** Applies a new answer for a dimension, refreshing `updatedAt`. */
export function withChoice<T extends string>(
  state: QuizState,
  key: DimensionKey,
  choice: DimensionChoice<T>,
  now: Date | string = new Date(),
): QuizState {
  return { ...state, [key]: choice, updatedAt: iso(now) };
}

/** Moves to the next step, never past the last one. */
export function goToNextStep(state: QuizState, now: Date | string = new Date()): QuizState {
  if (state.step >= QUIZ_STEP_COUNT) return state;
  const step = (state.step + 1) as QuizStep;
  return { ...state, step, updatedAt: iso(now) };
}

/** Moves to the previous step, retaining every answer (FR-008). */
export function goToPreviousStep(state: QuizState, now: Date | string = new Date()): QuizState {
  if (state.step <= 1) return state;
  const step = (state.step - 1) as QuizStep;
  return { ...state, step, updatedAt: iso(now) };
}

/** Sets the "Show content on other platforms" flag (FR-006). */
export function withUnownedProviders(
  state: QuizState,
  includeUnownedProviders: boolean,
  now: Date | string = new Date(),
): QuizState {
  return { ...state, includeUnownedProviders, updatedAt: iso(now) };
}

/** Finishes the quiz: marks it completed and stamps `completedAt` (FR-009). */
export function completeQuiz(state: QuizState, now: Date | string = new Date()): QuizState {
  const timestamp = iso(now);
  return { ...state, status: 'completed', completedAt: timestamp, updatedAt: timestamp };
}

/**
 * Reopens a completed quiz for editing, pre-filled with the previous answers
 * (FR-012). Completing the retake replaces the saved document (US3 scenario 3).
 */
export function startRetake(state: QuizState, now: Date | string = new Date()): QuizState {
  const { completedAt: _completedAt, ...rest } = state;
  return { ...rest, status: 'in-progress', step: 1, updatedAt: iso(now) };
}

/** The deck's input, or null while the quiz is still in progress. */
export function toPreference(state: QuizState): Preference | null {
  if (state.status !== 'completed' || !state.completedAt) return null;
  return {
    mediaType: state.mediaType,
    genre: state.genre,
    provider: state.provider,
    includeUnownedProviders: state.includeUnownedProviders,
    completedAt: state.completedAt,
  };
}
