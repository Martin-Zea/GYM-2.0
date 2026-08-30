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
    it('sin propuesta pendiente, aceptar no hace nada', () => {
      const before = TestBed.inject(StateService).settings().userProfile;
      chat.acceptProposal();
      expect(TestBed.inject(StateService).settings().userProfile).toEqual(before);
    });

    it('aceptar escribe en el perfil, que es lo que lee la capa IA', () => {
      chat.proposal.set({ notes: 'Empezó boxeo 2x semana', goal: 'strength' });
      chat.acceptProposal();

      const profile = TestBed.inject(StateService).settings().userProfile;
      expect(profile.aiNotes).toBe('Empezó boxeo 2x semana');
      expect(profile.goal).toBe('strength');
      expect(chat.proposal()).toBeNull();
    });

    it('cambiar el contexto INVALIDA las sugerencias precalculadas', () => {
      // Si el hash no cambiara, aceptar "empecé boxeo" no movería ni un número y la
      // propuesta sería decorativa.
      const state = TestBed.inject(StateService);
      const progression = TestBed.inject(ProgressionService);
      const day = state.currentDay()!;

      const before = progression.contextHash(
        progression.buildSessionContext(day, state.settings(), 'es'),
      );

      chat.proposal.set({ notes: 'Vuelve de una lesión de hombro' });
      chat.acceptProposal();

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
