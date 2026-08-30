import { AppState } from '../models/workout.model';

/**
 * Formato de los archivos de backup (RF-STO-05, RF-STO-05b).
 *
 * El export anterior era el `AppState` crudo con dos campos sueltos: sin forma de saber si
 * el archivo llegó completo, y con las keys de IA en texto plano dentro de un archivo que
 * el usuario manda por WhatsApp o sube a Drive (`audit.md` R-8).
 *
 * Ahora el estado viaja dentro de un sobre con checksum y las credenciales quedan fuera
 * salvo que se pidan explícitamente. Los backups viejos se siguen aceptando: un archivo
 * que alguien guardó hace meses tiene que poder restaurarse.
 */

export const BACKUP_FORMAT = 'gymtrack-backup';
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  appVersion: string;
  /** Si es `false`, `state.settings` viaja con las keys vacías. */
  includesCredentials: boolean;
  /** Checksum del estado serializado canónicamente. */
  checksum: string;
  state: AppState;
}

/**
 * Serialización canónica: claves ordenadas en todos los niveles.
 *
 * `JSON.stringify` conserva el orden de inserción, así que dos estados idénticos podrían
 * producir cadenas distintas y, con ellas, checksums distintos. Ordenar elimina esa
 * fuente de falsos negativos.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}

/**
 * Checksum FNV-1a de 32 bits.
 *
 * Detecta corrupción y truncamiento, que es para lo que sirve un checksum de backup. NO
 * es una firma: no protege contra manipulación deliberada, y no pretende hacerlo — los
 * datos ya son del usuario y no hay secreto que proteger.
 */
export function checksumOf(value: unknown): string {
  const text = canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Arma el sobre listo para escribir a disco. */
export function buildBackup(
  state: AppState,
  opts: {
    appVersion: string;
    includeCredentials: boolean;
    /** Keys en claro, que solo conoce `ApiKeyService`. Necesarias para que el backup sirva. */
    credentials?: { groq: string; cohere: string };
  },
): BackupEnvelope {
  // El sobre NUNCA lleva `apiKeySealed`. Ese blob está cifrado con una clave no extraíble que
  // vive en el IndexedDB de ESTE dispositivo: en otro teléfono —o aquí mismo tras borrar los
  // datos del sitio, que es justo cuando se restaura— sería indescifrable, y en silencio.
  // Una credencial portable tiene que viajar en claro o no viajar.
  const settings = opts.includeCredentials
    ? {
        ...state.settings,
        // Sin `credentials` se cae al texto plano del estado: es lo que hay en navegadores
        // sin WebCrypto y en estados anteriores a F4, y perderlo sería vaciar el backup.
        apiKey: opts.credentials?.groq || state.settings.apiKey || '',
        cohereApiKey: opts.credentials?.cohere || state.settings.cohereApiKey || '',
        apiKeySealed: undefined,
        cohereApiKeySealed: undefined,
      }
    : {
        ...state.settings,
        apiKey: '',
        cohereApiKey: '',
        // Cifrada o no, sigue siendo la credencial del usuario y no entra en un archivo que
        // se comparte (R-8).
        apiKeySealed: undefined,
        cohereApiKeySealed: undefined,
      };

  const payload: AppState = { ...state, settings };

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: opts.appVersion,
    includesCredentials: opts.includeCredentials,
    checksum: checksumOf(payload),
    state: payload,
  };
}

export interface ParsedBackup {
  /** El estado, aún sin validar contra el esquema (de eso se encarga `validateImport`). */
  state: unknown;
  /** `true` si venía sin sobre (formato anterior a esta versión). */
  legacy: boolean;
  /** `true` si el archivo trae las keys de IA dentro. */
  includesCredentials: boolean;
}

/**
 * Abre el sobre y verifica el checksum. Lanza con mensaje en español si el archivo está
 * corrupto; acepta sin chistar los backups del formato anterior.
 */
export function parseBackup(data: unknown): ParsedBackup {
  if (typeof data !== 'object' || data === null) {
    throw new Error('El archivo no contiene un objeto JSON válido.');
  }
  const d = data as Record<string, unknown>;

  if (d['format'] !== BACKUP_FORMAT) {
    // Formato anterior: el archivo ERA el estado. Se acepta, sin checksum que verificar.
    return { state: data, legacy: true, includesCredentials: hasCredentials(d) };
  }

  if (typeof d['checksum'] !== 'string' || typeof d['state'] !== 'object' || d['state'] === null) {
    throw new Error('El backup está incompleto: falta el estado o su checksum.');
  }

  const actual = checksumOf(d['state']);
  if (actual !== d['checksum']) {
    throw new Error(
      'El backup está dañado: el checksum no coincide. Probá con otra copia; los datos actuales no se tocaron.',
    );
  }

  return {
    state: d['state'],
    legacy: false,
    includesCredentials: d['includesCredentials'] === true,
  };
}

function hasCredentials(d: Record<string, unknown>): boolean {
  const settings = d['settings'];
  if (typeof settings !== 'object' || settings === null) return false;
  const s = settings as Record<string, unknown>;
  return Boolean(s['apiKey'] || s['cohereApiKey'] || s['apiKeySealed'] || s['cohereApiKeySealed']);
}
