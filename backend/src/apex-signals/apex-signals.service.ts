import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ApexSignal {
  id?: string | number;
  mercado: string;
  direccion: 'COMPRA' | 'VENTA' | string;
  estrellas: number;
  rb: number;
  recorrido: string;
  entrada: number;
  sl: number;
  tp: number;
  sesgo: string;
  fuente: 'CARTOGRAFO' | 'RADAR';
  capturedAt: string;
}

export interface ApexSignalsState {
  signals: ApexSignal[];
  radar: any[];
  cartografo: any[];
  lastUpdated: string | null;
  sessionActive: boolean;
  lastError: string | null;
}

// ─── Service ─────────────────────────────────────────────────────────────────

const APEX_BASE            = 'https://apexfusion.app/cartografo/panel';
const CUENTA_DEFAULT       = process.env.APEX_CUENTA || '41116831';
const HUELLA_DEFAULT       = process.env.APEX_HUELLA || 'apexbackend000000000000000000000';
const POLL_MS              = 5 * 60_000;      // 5 minutos
const COOLDOWN_ON_ERROR_MS = 5 * 60 * 1000;   // 5 minutos de espera si falla el login

@Injectable()
export class ApexSignalsService implements OnModuleInit {
  private readonly logger = new Logger(ApexSignalsService.name);

  private sessionFilePath: string = path.join(process.cwd(), '.apex-session.json');

  private sessionToken: string | null = null;
  private huella: string = HUELLA_DEFAULT;
  private isAuthenticating: boolean = false;
  private cooldownUntil: number = 0;
  private licenseBlocked: boolean = false;
  private lastError: string | null = null;

  private cachedSignals: ApexSignal[] = [];
  private rawRadar: any[] = [];
  private rawSenales: any[] = [];
  private lastUpdated: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {}

  async onModuleInit() {
    this.loadSessionFile();

    // 0. Si hay token en variable de entorno .env, usarlo preferentemente
    if (!this.licenseBlocked && process.env.APEX_SESSION_TOKEN && !this.sessionToken) {
      this.sessionToken = process.env.APEX_SESSION_TOKEN.trim();
      this.logger.log('🔑 Usando APEX_SESSION_TOKEN desde variables de entorno.');
    }

    if (this.licenseBlocked) {
      this.logger.warn('ApexFusion desactivado: licencia no vigente. No se intentará conectar automáticamente.');
    } else {
      // 1. Verificar si ya tenemos una sesión guardada y si sigue activa
      let validSession = false;
      if (this.sessionToken) {
        this.logger.log('🔍 Validando sesión guardada de ApexFusion...');
        validSession = await this.testSession();
        if (validSession) {
          this.logger.log(`✅ Sesión ApexFusion reutilizada exitosamente (cuenta ${CUENTA_DEFAULT}). No se requiere nuevo login.`);
          this.lastError = null;
          await this.fetchAndCache();
        } else {
          this.logger.warn('⚠️ La sesión guardada ha expirado o no es válida. Se intentará autenticar una sola vez...');
          this.sessionToken = null;
        }
      }

      // 2. Si no hay sesión válida, autenticar UNA SOLA VEZ con la huella registrada
      if (!this.sessionToken) {
        const autoRelevo = process.env.APEX_AUTO_RELEVO === 'true';
        await this.authenticate({ relevo: autoRelevo });
        if (this.sessionToken) {
          await this.fetchAndCache();
        }
      }
    }

    // 3. Iniciar el ciclo de polling de 5m
    this.pollTimer = setInterval(() => this.tick(), POLL_MS);
  }

  // ── Session File Management ───────────────────────────────────────────────

  private findSessionFilePath(): string {
    const candidates = [
      process.env.APEX_SESSION_FILE,
      path.join(process.cwd(), '.apex-session.json'),
      path.join(process.cwd(), 'backend', '.apex-session.json'),
      path.join(__dirname, '..', '..', '.apex-session.json'),
      path.join(__dirname, '..', '..', '..', '.apex-session.json'),
    ].filter(Boolean) as string[];

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return path.join(process.cwd(), '.apex-session.json');
  }

  private loadSessionFile() {
    this.sessionFilePath = this.findSessionFilePath();
    try {
      if (fs.existsSync(this.sessionFilePath)) {
        const raw = fs.readFileSync(this.sessionFilePath, 'utf-8');
        const data = JSON.parse(raw);
        this.huella = data.huella || HUELLA_DEFAULT;
        this.licenseBlocked = data.licenseBlocked === true;
        this.sessionToken = this.licenseBlocked ? null : data.sesion || null;
        if (this.licenseBlocked) this.lastError = 'licencia no vigente para esa cuenta';
        this.logger.log(`📄 Archivo de sesión cargado desde: ${this.sessionFilePath}`);
      }
    } catch (err: any) {
      this.logger.warn(`No se pudo leer archivo de sesión: ${err?.message}`);
    }

    // Asegurar huella fija registrada (nunca generar huellas aleatorias que causen 403 Forbidden)
    if (!this.huella || this.huella.length < 16) {
      this.huella = HUELLA_DEFAULT;
      this.saveSessionFile();
    }
  }

  private saveSessionFile() {
    try {
      const data = {
        huella: this.huella || HUELLA_DEFAULT,
        sesion: this.sessionToken,
        licenseBlocked: this.licenseBlocked,
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(this.sessionFilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err: any) {
      this.logger.error(`Error guardando archivo de sesión: ${err?.message}`);
    }
  }

  // ── Session Validation ────────────────────────────────────────────────────

  private async testSession(): Promise<boolean> {
    if (!this.sessionToken) return false;
    try {
      const res = await fetch(`${APEX_BASE}/senales`, {
        headers: { 'X-Sesion': this.sessionToken },
      });
      if (!res.ok) return false;
      const data: any = await res.json();
      if (data?.ok === false && (data?.error?.includes('sesion') || data?.error?.includes('requerida'))) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  // ── Authentication ("UNA SOLA VEZ" con cerrojo y enfriamiento) ─────────────

  public async authenticate(opts?: { relevo?: boolean; cuenta?: string }): Promise<boolean> {
    if (this.licenseBlocked) {
      this.logger.warn('Autenticación ApexFusion omitida: la licencia no está vigente.');
      return false;
    }

    // Si ya hay una autenticación en curso, evitar duplicados simultáneos
    if (this.isAuthenticating) {
      this.logger.debug('Autenticación ya en curso, ignorando llamada duplicada.');
      return false;
    }

    this.isAuthenticating = true;
    const cuenta = opts?.cuenta || CUENTA_DEFAULT;
    const relevo = opts?.relevo ?? false;

    try {
      this.logger.log(`🔑 Autenticando con ApexFusion (cuenta: ${cuenta}, relevo: ${relevo})...`);

      const res = await fetch(`${APEX_BASE}/entrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cuenta,
          relevo,
          huella: this.huella,
        }),
      });

      const data: any = await res.json();

      if (data?.ok && data?.sesion) {
        this.sessionToken = data.sesion;
        this.lastError = null;
        this.cooldownUntil = 0;
        this.saveSessionFile();
        this.logger.log(`✅ Autenticado OK. Sesión: ${this.sessionToken?.slice(0, 10)}... (guardada en disco)`);
        return true;
      }

      if (data?.error === 'DOS_LUGARES') {
        this.lastError = data.mensaje || 'esta licencia ya está abierta en 2 dispositivos';
        // Enfriamiento de 5 minutos para NO saturar el servidor ni llenar la consola
        this.cooldownUntil = Date.now() + COOLDOWN_ON_ERROR_MS;
        this.logger.warn(`⚠️ ApexFusion: ${this.lastError}. No se reintentará automáticamente en bucle. (Puedes forzar relevo desde la interfaz si lo deseas).`);
        return false;
      }

      this.lastError = data?.mensaje || data?.error || 'Autenticación fallida';
      this.cooldownUntil = Date.now() + COOLDOWN_ON_ERROR_MS;
      if (String(data?.error || '').toLowerCase().includes('licencia no vigente')) {
        this.licenseBlocked = true;
        this.sessionToken = null;
        this.saveSessionFile();
        this.logger.warn('ApexFusion detenido: licencia no vigente para esa cuenta. No se reintentará automáticamente.');
        return false;
      }
      this.logger.warn(`❌ Autenticación fallida: ${JSON.stringify(data)}`);
      return false;
    } catch (err: any) {
      this.lastError = err?.message ?? String(err);
      this.cooldownUntil = Date.now() + COOLDOWN_ON_ERROR_MS;
      this.logger.error(`Error de conexión al autenticar: ${this.lastError}`);
      return false;
    } finally {
      this.isAuthenticating = false;
    }
  }

  // ── Polling Tick ──────────────────────────────────────────────────────────

  private async tick() {
    if (this.licenseBlocked) return;

    // Si no hay sesión activa:
    if (!this.sessionToken) {
      // Si estamos en período de enfriamiento tras un error (como DOS_LUGARES), NO saturar
      if (Date.now() < this.cooldownUntil) {
        return;
      }
      // Si ya pasó el enfriamiento, intentar autenticar UNA sola vez
      const ok = await this.authenticate({ relevo: false });
      if (!ok) return;
    }

    // Con sesión activa, actualizar señales
    await this.fetchAndCache();
  }

  // ── Signals Fetch & Cache ─────────────────────────────────────────────────

  private async fetchAndCache() {
    if (!this.sessionToken) return;

    try {
      const headers = { 'X-Sesion': this.sessionToken };

      // Consultar en paralelo tanto las señales del cartógrafo como las oportunidades del radar (asistente)
      const [senalesRes, radarRes] = await Promise.all([
        fetch(`${APEX_BASE}/senales`, { headers }),
        fetch(`${APEX_BASE}/oportunidades-radar`, { headers }),
      ]);

      const senalesData: any = await senalesRes.json();
      const radarData: any   = await radarRes.json();

      // Verificar si alguna petición reporta sesión inválida
      const sessionError =
        (senalesData?.ok === false && String(senalesData?.error).includes('sesion')) ||
        (radarData?.ok === false && String(radarData?.error).includes('sesion'));

      if (sessionError) {
        this.logger.warn('⚠️ Sesión de ApexFusion expirada en tiempo de ejecución.');
        this.sessionToken = null;
        this.saveSessionFile();
        // Intentar renovar sesión UNA sola vez
        await this.authenticate({ relevo: false });
        return;
      }

      const now = new Date().toISOString();

      // 1. Parsear Oportunidades del Asistente de Trading (Radar)
      const radarList: ApexSignal[] = (radarData?.oportunidades ?? []).map((o: any) => {
        const score = Number(o.score ?? 0);
        const estrellas = score >= 80 ? 4 : score >= 65 ? 3 : score >= 50 ? 2 : 1;
        return {
          mercado: String(o.simbolo ?? 'Desconocido').replace(' Index', ''),
          direccion: String(o.lado ?? 'NEUTRAL').toUpperCase(),
          estrellas,
          rb: Number(o.rb ?? 0),
          recorrido: o.recorrido != null ? `${o.recorrido}%` : '—',
          entrada: Number(o.entrada ?? 0),
          sl: Number(o.sl ?? 0),
          tp: Number(o.tp ?? 0),
          sesgo: o.macro ? String(o.macro) : '',
          fuente: 'RADAR' as const,
          capturedAt: now,
        };
      });

      // 2. Parsear Señales del Cartógrafo
      const cartografoList: ApexSignal[] = (senalesData?.senales ?? []).map((s: any) => {
        const entrada = Number(s.entrada ?? 0);
        const sl      = Number(s.sl ?? 0);
        const tp      = Number(s.tp ?? 0);
        const diff    = Math.abs(entrada - sl);
        const rb      = diff > 0 ? Number((Math.abs(tp - entrada) / diff).toFixed(2)) : 0;
        return {
          id: s.id,
          mercado: String(s.mercado ?? 'Desconocido').replace(' Index', ''),
          direccion: String(s.lado ?? 'NEUTRAL').toUpperCase(),
          estrellas: 3,
          rb,
          recorrido: '—',
          entrada,
          sl,
          tp,
          sesgo: s.especialista ? String(s.especialista) : '',
          fuente: 'CARTOGRAFO' as const,
          capturedAt: now,
        };
      });

      // Lista combinada: Primero las del Asistente de Trading (Radar), luego Cartógrafo
      this.cachedSignals = [...radarList, ...cartografoList];
      this.rawRadar      = radarData?.oportunidades ?? [];
      this.rawSenales    = senalesData?.senales ?? [];
      this.lastUpdated   = now;
      this.lastError     = null;

      this.logger.debug(
        `📊 Señales ApexFusion actualizadas: ${this.cachedSignals.length} (${radarList.length} radar, ${cartografoList.length} cartógrafo)`
      );
    } catch (err: any) {
      this.logger.error(`Error al obtener señales de ApexFusion: ${err?.message ?? err}`);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  getSignals(): ApexSignalsState {
    return {
      signals:       this.cachedSignals,
      radar:         this.rawRadar,
      cartografo:    this.rawSenales,
      lastUpdated:   this.lastUpdated,
      sessionActive: !!this.sessionToken,
      lastError:     this.lastError,
    };
  }

  async forceRefresh(): Promise<ApexSignalsState> {
    await this.tick();
    return this.getSignals();
  }

  async manualLogin(relevo: boolean = false, cuenta?: string): Promise<{ ok: boolean; message: string }> {
    this.licenseBlocked = false;
    this.cooldownUntil = 0; // Quitar cooldown si el usuario pide login manual
    this.saveSessionFile();
    const ok = await this.authenticate({ relevo, cuenta });
    if (ok) {
      await this.fetchAndCache();
      return { ok: true, message: 'Sesión iniciada correctamente' };
    }
    return { ok: false, message: this.lastError || 'Error al autenticar' };
  }

  async setSession(token: string): Promise<{ ok: boolean; message: string }> {
    if (!token || typeof token !== 'string') {
      return { ok: false, message: 'Token inválido' };
    }
    this.sessionToken = token.trim();
    this.saveSessionFile();

    const valid = await this.testSession();
    if (valid) {
      this.lastError = null;
      this.cooldownUntil = 0;
      await this.fetchAndCache();
      this.logger.log('✅ Token de sesión establecido y validado manualmente.');
      return { ok: true, message: 'Sesión guardada y validada correctamente' };
    } else {
      this.lastError = 'El token proporcionado no fue aceptado por ApexFusion';
      return { ok: false, message: this.lastError };
    }
  }
}
