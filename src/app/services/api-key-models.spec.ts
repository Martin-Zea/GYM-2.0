import { extractModelIds, isModelError } from './api-key.service';

describe('isModelError() — distinguir "modelo no disponible" del resto (T-808)', () => {
  it('reconoce el código exacto que devuelve Groq', () => {
    expect(
      isModelError({
        error: {
          message:
            'The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.',
          code: 'model_not_found',
        },
      }),
    ).toBe(true);
  });

  it('también por el mensaje, para proveedores que no mandan código', () => {
    expect(isModelError({ error: { message: 'unknown model' } })).toBe(true);
  });

  it('no confunde otros fallos: una key inválida no se arregla eligiendo modelo', () => {
    expect(isModelError({ error: { message: 'invalid api key', code: 'invalid_api_key' } })).toBe(
      false,
    );
  });

  it('un cuerpo ilegible no se interpreta como error de modelo', () => {
    expect(isModelError(null)).toBe(false);
    expect(isModelError('boom')).toBe(false);
  });
});

describe('extractModelIds() — leer la lista de cada proveedor (T-808)', () => {
  it('Groq responde en formato OpenAI: { data: [{ id }] }', () => {
    const ids = extractModelIds(
      { data: [{ id: 'llama-3.1-8b-instant' }, { id: 'openai/gpt-oss-20b' }] },
      'groq',
    );
    expect(ids).toEqual(['llama-3.1-8b-instant', 'openai/gpt-oss-20b']);
  });

  it('Cohere responde { models: [{ name }] }', () => {
    expect(extractModelIds({ models: [{ name: 'command-r7b-12-2024' }] }, 'cohere')).toEqual([
      'command-r7b-12-2024',
    ]);
  });

  it('descarta lo que no sirve para chatear: audio, embeddings, rerank', () => {
    const ids = extractModelIds(
      {
        data: [
          { id: 'whisper-large-v3' },
          { id: 'llama-3.1-8b-instant' },
          { id: 'text-embedding-3' },
        ],
      },
      'groq',
    );
    expect(ids).toEqual(['llama-3.1-8b-instant']);
  });

  it('una respuesta inesperada devuelve lista vacía en vez de reventar', () => {
    expect(extractModelIds({}, 'groq')).toEqual([]);
    expect(extractModelIds(null, 'groq')).toEqual([]);
  });
});
