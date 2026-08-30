import { MAX_NOTES, parseCoachReply, validateProposal } from './coach-proposal';

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
