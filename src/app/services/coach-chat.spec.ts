import { TestBed } from '@angular/core/testing';
import { CoachChatService } from './coach-chat.service';
import { StateService } from './state.service';
import { ProgressionService } from './progression.service';
import { TabLockService } from './tab-lock.service';
import { AppSettings } from '../models/workout.model';
import { STORAGE_KEYS } from './storage-keys';
import { DEFAULT_TOKEN_BUDGET, resetUsage } from './providers/ai-usage';

function settings(over: Partial<AppSettings> = {}): AppSettings {
  return { apiKey: '', cohereApiKey: '', ...over } as AppSettings;
}

/** `navigator.onLine` es de solo lectura; para probar el corte offline hay que redefinirlo. */
function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

describe('CoachChatService — límites del chat (C2, RF-IA-10)', () => {
  let chat: CoachChatService;

  beforeEach(() => {
    localStorage.clear();
    resetUsage();
    setOnline(true);
    TestBed.inject(StateService);
    chat = TestBed.inject(CoachChatService);
  });

  afterEach(() => {
    setOnline(true);
    TestBed.inject(TabLockService).releaseForTest();
  });

  describe('cuándo se bloquea', () => {
    it('sin key no se puede chatear: es el caso de RF-IA-10', () => {
      expect(chat.blockedBy(settings())).toBe('no_key');
    });

    it('con key pero sin conexión tampoco, y se distingue del caso anterior', () => {
      setOnline(false);
      expect(chat.blockedBy(settings({ apiKey: 'gsk_x' }))).toBe('offline');
    });

    it('un presupuesto de 0 apaga el chat sin tener que borrar la key', () => {
      expect(chat.blockedBy(settings({ apiKey: 'gsk_x', aiTokenBudget: 0 }))).toBe('over_budget');
    });

    it('con key, red y presupuesto no hay bloqueo', () => {
      expect(chat.blockedBy(settings({ apiKey: 'gsk_x' }))).toBeNull();
    });

    it('Cohere sirve igual que Groq: la cascada no obliga a tener la primera', () => {
      expect(chat.blockedBy(settings({ cohereApiKey: 'co_x' }))).toBeNull();
    });
  });

  describe('send() respeta el bloqueo', () => {
    it('sin key no registra el mensaje: sería una conversación que no va a ninguna parte', async () => {
      await chat.send('¿subo el peso?', settings(), 'es');
      expect(chat.messages()).toHaveLength(0);
    });

    it('un mensaje vacío no cuenta', async () => {
      await chat.send('   ', settings({ apiKey: 'gsk_x' }), 'es');
      expect(chat.messages()).toHaveLength(0);
    });
  });

  describe('propuestas de contexto (T-811)', () => {
    it('sin propuesta pendiente, aceptar no hace nada', async () => {
      const before = TestBed.inject(StateService).settings().userProfile;
      await chat.acceptProposal();
      expect(TestBed.inject(StateService).settings().userProfile).toEqual(before);
    });

    it('aceptar escribe en el perfil, que es lo que lee la capa IA', async () => {
      chat.proposal.set({ notes: 'Empezó boxeo 2x semana', goal: 'strength' });
      await chat.acceptProposal();

      const profile = TestBed.inject(StateService).settings().userProfile;
      expect(profile.aiNotes).toBe('Empezó boxeo 2x semana');
      expect(profile.goal).toBe('strength');
      expect(chat.proposal()).toBeNull();
    });

    it('cambiar el contexto INVALIDA las sugerencias precalculadas', async () => {
      // Si el hash no cambiara, aceptar "empecé boxeo" no movería ni un número y la
      // propuesta sería decorativa.
      const state = TestBed.inject(StateService);
      const progression = TestBed.inject(ProgressionService);
      const day = state.currentDay()!;

      const before = progression.contextHash(
        progression.buildSessionContext(day, state.settings(), 'es'),
      );

      chat.proposal.set({ notes: 'Vuelve de una lesión de hombro' });
      await chat.acceptProposal();

      const after = progression.contextHash(
        progression.buildSessionContext(day, state.settings(), 'es'),
      );
      expect(after).not.toBe(before);
    });

    it('descartar no toca el perfil', () => {
      const before = TestBed.inject(StateService).settings().userProfile.aiNotes;
      chat.proposal.set({ notes: 'no quiero esto' });
      chat.dismissProposal();

      expect(chat.proposal()).toBeNull();
      expect(TestBed.inject(StateService).settings().userProfile.aiNotes).toBe(before);
    });
  });

  describe('pesos aceptados llegan a las sugerencias (T-813)', () => {
    it('aceptar escribe la sugerencia que el panel y el prefill leen', async () => {
      const state = TestBed.inject(StateService);
      const progression = TestBed.inject(ProgressionService);
      const day = state.currentDay()!;
      const target = day.exercises[0];

      await chat.previewProposal(
        { weights: [{ exercise: target.name, weight: 12.5 }] },
        state.settings(),
      );
      await chat.acceptProposal();

      const result = await progression.suggestionsForToday(day, state.settings(), 'es', {
        state: state.state(),
      });
      expect(result.byExercise[target.id]?.sets[0].weight).toBe(12.5);
    });

    it('lo que se guarda es EXACTAMENTE lo que decía la tarjeta', async () => {
      // Si aceptar recalculara, confirmarías un número y te quedaría otro.
      const state = TestBed.inject(StateService);
      const progression = TestBed.inject(ProgressionService);
      const day = state.currentDay()!;
      const target = day.exercises[0];

      // Un peso a propósito NO alineado al ladrillo: el redondeo tiene que ocurrir antes de
      // pintar la tarjeta, no entre aceptar y guardar.
      const before = await progression.suggestionsForToday(day, state.settings(), 'es', {
        state: state.state(),
      });
      const currentTop = Math.max(...before.byExercise[target.id]!.sets.map((s) => s.weight));

      await chat.previewProposal(
        { weights: [{ exercise: target.name, weight: currentTop - 3.7 }] },
        state.settings(),
      );
      const shown = chat.proposedWeights()[0];
      expect(shown).toBeTruthy();
      await chat.acceptProposal();

      const result = await progression.suggestionsForToday(day, state.settings(), 'es', {
        state: state.state(),
      });
      expect(result.byExercise[target.id]?.sets[0].weight).toBe(shown.to);
    });

    it('no pisa la sugerencia de los ejercicios que no se tocaron', async () => {
      const state = TestBed.inject(StateService);
      const progression = TestBed.inject(ProgressionService);
      const day = state.currentDay()!;
      const [first, second] = day.exercises;

      await chat.previewProposal(
        { weights: [{ exercise: first.name, weight: 15 }] },
        state.settings(),
      );
      await chat.acceptProposal();

      const result = await progression.suggestionsForToday(day, state.settings(), 'es', {
        state: state.state(),
      });
      expect(result.byExercise[first.id]?.sets[0].weight).toBe(15);
      // El resto de la sesión sigue teniendo sugerencia, no queda vacío
      expect(result.byExercise[second.id]).toBeTruthy();
    });

    it('descartar no escribe nada', async () => {
      const state = TestBed.inject(StateService);
      const progression = TestBed.inject(ProgressionService);
      const day = state.currentDay()!;
      const target = day.exercises[0];
      const before = await progression.suggestionsForToday(day, state.settings(), 'es', {
        state: state.state(),
      });

      await chat.previewProposal(
        { weights: [{ exercise: target.name, weight: 5 }] },
        state.settings(),
      );
      chat.dismissProposal();

      const after = await progression.suggestionsForToday(day, state.settings(), 'es', {
        state: state.state(),
      });
      expect(after.byExercise[target.id]?.sets[0].weight).toBe(
        before.byExercise[target.id]?.sets[0].weight,
      );
    });
  });

  describe('volver tras un parón cambia los pesos (T-817, T-819)', () => {
    it('"vuelvo tras dos meses" baja las cargas de la próxima sesión', async () => {
      // El escenario que no funcionaba: contarlo por chat no movía ni un gramo, porque el
      // registro decía que habías entrenado hace una semana y nadie escuchaba tu palabra.
      const state = TestBed.inject(StateService);
      const day = state.currentDay()!;

      await chat.previewProposal(
        { notes: 'Vuelve tras 2 meses parado', layoffDays: 60 },
        state.settings(),
      );

      const rows = chat.proposedWeights();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => r.to < r.from)).toBe(true);
      expect(rows.every((r) => r.to <= r.from)).toBe(true);
      expect(day).toBeTruthy();
    });

    it('sin declararlo no cambia nada: el motor solo ve lo que el registro dice', async () => {
      const state = TestBed.inject(StateService);
      await chat.previewProposal({ notes: 'Todo bien, sigo igual' }, state.settings());
      expect(chat.proposedWeights()).toEqual([]);
    });

    it('aceptar guarda los pesos que se enseñaron, ejercicio por ejercicio', async () => {
      const state = TestBed.inject(StateService);
      const progression = TestBed.inject(ProgressionService);
      const day = state.currentDay()!;

      await chat.previewProposal({ layoffDays: 60 }, state.settings());
      const shown = chat.proposedWeights();
      await chat.acceptProposal();

      const after = await progression.suggestionsForToday(day, state.settings(), 'es', {
        state: state.state(),
      });
      for (const row of shown) {
        const sets = after.byExercise[row.exerciseId]!.sets;
        expect(Math.max(...sets.map((x) => x.weight))).toBe(row.to);
      }
    });

    it('el parón queda declarado en el perfil, no solo en la conversación', async () => {
      const state = TestBed.inject(StateService);
      await chat.previewProposal({ layoffDays: 60 }, state.settings());
      await chat.acceptProposal();

      expect(state.settings().userProfile.layoffSinceISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('y deja de valer en cuanto volvés a entrenar', async () => {
      // Si no se borrara, la sesión de vuelta seguiría contando como "dos meses parado"
      // para siempre y no volverías a progresar nunca.
      const state = TestBed.inject(StateService);
      const day = state.currentDay()!;
      await chat.previewProposal({ layoffDays: 60 }, state.settings());
      await chat.acceptProposal();

      state.finishSession(day.id);

      expect(state.settings().userProfile.layoffSinceISO).toBeNull();
    });

    it('descartar la propuesta no declara ningún parón', async () => {
      const state = TestBed.inject(StateService);
      await chat.previewProposal({ layoffDays: 60 }, state.settings());
      chat.dismissProposal();

      expect(state.settings().userProfile.layoffSinceISO).toBeFalsy();
    });
  });

  describe('historial', () => {
    it('el presupuesto por defecto es el mismo que usa la progresión', () => {
      // Si el chat tuviera bolsa propia, el presupuesto dejaría de significar algo.
      expect(chat.budget()).toBe(DEFAULT_TOKEN_BUDGET);
    });

    it('se guarda fuera del estado, así que no viaja en los backups', () => {
      // El backup serializa el AppState. Si la conversación viviera ahí, restaurar una copia
      // resucitaría charlas viejas junto con el entrenamiento.
      localStorage.setItem(
        STORAGE_KEYS.coachChat,
        JSON.stringify([{ id: 'x', role: 'user', text: 'FRASE_DE_PRUEBA', atISO: '' }]),
      );
      const serialized = JSON.stringify(TestBed.inject(StateService).state());
      expect(serialized).not.toContain('FRASE_DE_PRUEBA');
      expect(serialized).not.toContain('coachChat');
    });

    it('clear() deja la conversación vacía', () => {
      chat.clear();
      expect(chat.messages()).toEqual([]);
    });
  });
});
