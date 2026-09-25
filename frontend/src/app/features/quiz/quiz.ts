import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  DimensionChoice,
  MEDIA_TYPE_LABELS,
  QUIZ_STEP_COUNT,
  QuizState,
} from '../../core/models/quiz';
import { PreferenceStore } from '../../core/services/preference-store';
import { QuizOptionsService } from '../../core/services/quiz-options.service';
import { ChipOption } from './steps/choice-chips';
import {
  DimensionKey,
  canAdvance as isStepAnswered,
  completeQuiz,
  createInitialQuizState,
  goToNextStep,
  goToPreviousStep,
  startRetake,
  withChoice,
  withUnownedProviders,
} from './quiz-logic/quiz-rules';
import { StepGenres } from './steps/step-genres';
import { StepMediaType } from './steps/step-media-type';
import { StepProviders } from './steps/step-providers';
import { Summary } from './summary/summary';

/**
 * The onboarding quiz shell: owns the visitor's answers, walks the three
 * steps, and persists every change so nothing is lost to a refresh (FR-010).
 */
@Component({
  selector: 'app-quiz',
  imports: [StepMediaType, StepGenres, StepProviders, Summary],
  templateUrl: './quiz.html',
})
export class Quiz {
  private readonly store = inject(PreferenceStore);
  private readonly optionsService = inject(QuizOptionsService);
  private readonly router = inject(Router);

  /** Resumes a saved quiz when one exists, otherwise starts a fresh visit. */
  protected readonly state = signal<QuizState>(this.store.read() ?? createInitialQuizState());

  protected readonly stepCount = QUIZ_STEP_COUNT;
  protected readonly isSummary = computed(() => this.state().status === 'completed');
  protected readonly canGoNext = computed(() => isStepAnswered(this.state()));

  protected readonly mediaTypeOptions = computed<ChipOption[]>(() =>
    this.optionsService
      .getMediaTypes()
      .map((mediaType) => ({ id: mediaType, label: MEDIA_TYPE_LABELS[mediaType] })),
  );

  protected readonly genreOptions = computed<ChipOption[]>(() =>
    this.optionsService
      .getGenres()
      .map((genre) => ({ id: genre.id, label: genre.displayName })),
  );

  protected onChoice(key: DimensionKey, choice: DimensionChoice<string>): void {
    this.update(withChoice(this.state(), key, choice));
  }

  protected onUnownedProvidersChange(includeUnownedProviders: boolean): void {
    this.update(withUnownedProviders(this.state(), includeUnownedProviders));
  }

  /** Advances a step, or completes the quiz on the last one (FR-009). */
  protected next(): void {
    const current = this.state();
    if (!isStepAnswered(current)) return;

    this.update(
      current.step < QUIZ_STEP_COUNT ? goToNextStep(current) : completeQuiz(current),
    );
  }

  /** Back retains every answer already given (FR-008). */
  protected back(): void {
    this.update(goToPreviousStep(this.state()));
  }

  /** Reopens the quiz at step 1 with the previous answers pre-filled (FR-012). */
  protected retake(): void {
    this.update(startRetake(this.state()));
  }

  protected startRecommendations(): void {
    this.router.navigate(['/deck']);
  }

  /** Every transition is persisted immediately, so a refresh loses nothing. */
  private update(next: QuizState): void {
    this.state.set(next);
    this.store.write(next);
  }
}
