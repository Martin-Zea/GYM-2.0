import {
  MAX_NOTES,
  parseCoachReply,
  resolveWeightProposal,
  validateProposal,
} from './coach-proposal';
import { AiSessionContext } from './providers/session-context';
import { Exercise, SetRecord, UserProfile } from '../models/workout.model';

describe('parseCoachReply() — separar la charla de la propuesta (T-811)', () => {
  it('una respuesta normal no propone nada', () => {
    const out = parseCoachReply('Con tu volumen actual podés meter un día más.');
    expect(out.proposal).toBeNull();
    expect(out.text).toBe('Con tu volumen actual podés meter un día más.');
  });

  it('extrae la propuesta y la quita del texto que se muestra', () => {
    const out = parseCoachReply(
      'Lo anoto para adaptar tus cargas.\n' +
        '<<GT_CONTEXT>>{"notes":"Empezó boxeo 2x semana"}<<END>>',
    );
    expect(out.text).toBe('Lo anoto para adaptar tus cargas.');
    expect(out.proposal).toEqual({ notes: 'Empezó boxeo 2x semana' });
  });

  it('el bloque se quita SIEMPRE, aunque el JSON esté roto', () => {
    // Enseñar un `{"notes":` a medias es peor que perder la propuesta.
    const out = parseCoachReply('Anotado.<<GT_CONTEXT>>{"notes": roto<<END>>');
    expect(out.text).toBe('Anotado.');
    expect(out.proposal).toBeNull();
  });

  it('un bloque sin cerrar no deja basura en pantalla', () => {
    const out = parseCoachReply('Anotado.<<GT_CONTEXT>>{"notes":"a medias"');
    expect(out.text).toBe('Anotado.');
    expect(out.proposal).toBeNull();
  });

  it('acepta objetivo y nivel juntos', () => {
    const out = parseCoachReply(
      'Cambio tu enfoque.<<GT_CONTEXT>>{"goal":"strength","level":"advanced"}<<END>>',
    );
    expect(out.proposal).toEqual({ goal: 'strength', level: 'advanced' });
  });
});

describe('validateProposal() — nada del modelo entra sin filtrar (Art. 6)', () => {
  it('descarta un objetivo inventado pero conserva lo válido', () => {
    expect(validateProposal({ goal: 'ponerse_cachas', notes: 'vuelve de lesión' })).toEqual({
      notes: 'vuelve de lesión',
    });
  });

  it('descarta un nivel que no existe', () => {
    expect(validateProposal({ level: 'semidios' })).toBeNull();
  });

  it('recorta las notas al tamaño que la IA lee de verdad', () => {
    const out = validateProposal({ notes: 'x'.repeat(500) });
    expect(out?.notes).toHaveLength(MAX_NOTES);
  });

  it('unas notas vacías no son una propuesta', () => {
    expect(validateProposal({ notes: '   ' })).toBeNull();
  });

  it('IGNORA cualquier intento de tocar pesos o rutinas', () => {
    // El chat puede cambiar lo que la app SABE de vos, nunca lo que te manda levantar.
    const out = validateProposal({
      notes: 'ok',
      weight: 200,
      sets: [{ w: 200, r: 5 }],
      routines: [],
      apiKey: 'gsk-robada',
    });
    expect(out).toEqual({ notes: 'ok' });
  });

  it('una respuesta que no es un objeto no propone nada', () => {
    expect(validateProposal(null)).toBeNull();
    expect(validateProposal('subí 5kg')).toBeNull();
    expect(validateProposal(42)).toBeNull();
  });
});

// ── Pesos propuestos desde el chat (T-813) ──

function exercise(over: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex1',
    name: 'Press de Hombros',
    brick: 2.5,
    defaultSets: 3,
    defaultRepTarget: 8,
    restSeconds: 90,
    unit: 'KG',
    notes: '',
    ...over,
  };
}

function sets(weight: number): SetRecord[] {
  return [{ exerciseId: 'ex1', setIndex: 0, weight, reps: 8 }];
}

function sessionCtx(over: { lastSessionDate?: string; aiNotes?: string } = {}): AiSessionContext {
  return {
    dayId: 'd1',
    dayName: 'Hombros',
    userProfile: { aiNotes: over.aiNotes ?? '' } as UserProfile,
    lang: 'es',
    todayISO: '2026-08-30',
    exercises: [
      {
        exercise: exercise(),
        history: [],
        lastSets: sets(40),
        lastSessionDate: over.lastSessionDate ?? '2026-08-28',
        lastFeel: null,
        lastNote: null,
      },
    ],
  };
}

describe('resolveWeightProposal() — el chat propone, el validador manda (T-813)', () => {
  it('un peso razonable se aplica tal cual', () => {
    const out = resolveWeightProposal([{ exercise: 'Press de Hombros', weight: 35 }], sessionCtx());
    expect(out).toHaveLength(1);
    expect(out[0].from).toBe(40);
    expect(out[0].to).toBe(35);
    expect(out[0].clamped).toBe(false);
  });

  it('BAJAR siempre se permite: nadie se lesiona levantando menos', () => {
    const out = resolveWeightProposal([{ exercise: 'Press de Hombros', weight: 10 }], sessionCtx());
    expect(out[0].to).toBe(10);
    expect(out[0].clamped).toBe(false);
  });

  it('subir de más se RECORTA al tope, no se acepta ni se descarta', () => {
    // "ponme 200kg" no puede pasar solo porque lo pidieras por chat.
    const out = resolveWeightProposal(
      [{ exercise: 'Press de Hombros', weight: 200 }],
      sessionCtx(),
    );
    expect(out[0].to).toBeLessThanOrEqual(44); // 40 + 10%
    expect(out[0].clamped).toBe(true);
  });

  it('tras un parón el tope es MENOR que la última marca', () => {
    const ctx = sessionCtx({ lastSessionDate: '2026-05-30' }); // 3 meses
    const out = resolveWeightProposal([{ exercise: 'Press de Hombros', weight: 60 }], ctx);
    expect(out[0].to).toBe(32.5); // 85% de 40 = 34; al ladrillo SIN pasarse → 32,5
    expect(out[0].clamped).toBe(true);
  });

  it('una lesión declarada impide subir aunque lo pida el chat', () => {
    const ctx = sessionCtx({ aiNotes: 'molestia en Press de Hombros' });
    const out = resolveWeightProposal([{ exercise: 'Press de Hombros', weight: 60 }], ctx);
    expect(out[0].to).toBe(40); // se mantiene, no sube
    expect(out[0].clamped).toBe(true);
    // Y se SIGUE mostrando: un rechazo silencioso deja creyendo que el pedido se perdió.
    expect(out).toHaveLength(1);
  });

  it('el peso se redondea al ladrillo del ejercicio', () => {
    const out = resolveWeightProposal(
      [{ exercise: 'Press de Hombros', weight: 33.7 }],
      sessionCtx(),
    );
    expect(out[0].to % 2.5).toBe(0);
  });

  it('un ejercicio que no está en la sesión se descarta: el chat no añade ejercicios', () => {
    const out = resolveWeightProposal([{ exercise: 'Peso muerto', weight: 100 }], sessionCtx());
    expect(out).toEqual([]);
  });

  it('lo resuelve por nombre normalizado, no por coincidencia exacta', () => {
    const out = resolveWeightProposal(
      [{ exercise: 'press de hombros' }].map((x) => ({ ...x, weight: 35 })),
      sessionCtx(),
    );
    expect(out).toHaveLength(1);
  });

  it('un peso igual al actual no es un cambio y no se ofrece', () => {
    const out = resolveWeightProposal(
      [{ exercise: 'Press de Hombros', weight: 40, reps: 8 }],
      sessionCtx(),
    );
    expect(out).toEqual([]);
  });

  it('no repite el mismo ejercicio aunque el modelo lo mande dos veces', () => {
    const out = resolveWeightProposal(
      [
        { exercise: 'Press de Hombros', weight: 35 },
        { exercise: 'Press de Hombros', weight: 30 },
      ],
      sessionCtx(),
    );
    expect(out).toHaveLength(1);
  });
});

describe('validateProposal() con pesos', () => {
  it('descarta pesos que no son números usables', () => {
    const out = validateProposal({
      weights: [
        { exercise: 'A', weight: 'mucho' },
        { exercise: '', weight: 50 },
        { exercise: 'B', weight: -10 },
        { exercise: 'C', weight: 50 },
      ],
    });
    expect(out?.weights).toEqual([{ exercise: 'C', weight: 50 }]);
  });

  it('acota reps absurdas pero conserva el peso', () => {
    const out = validateProposal({ weights: [{ exercise: 'A', weight: 50, reps: 9999 }] });
    expect(out?.weights?.[0].reps).toBeUndefined();
    expect(out?.weights?.[0].weight).toBe(50);
  });
});
