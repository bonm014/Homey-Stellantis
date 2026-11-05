import * as crypto from 'crypto';
import * as mqtt from 'mqtt';
import axios from 'axios';
import { Otp, ConfigException } from './otp'
import type { OtpState } from './otp'

/**
 * API constants (same endpoints as the Home Assistant "stellantis_vehicles" integration)
 */
const API_BASE_URL = 'https://api.groupe-psa.com';
const GET_OTP_URL = `${API_BASE_URL}/applications/cvs/v4/mobile/smsCode`;
const GET_MQTT_TOKEN_URL = `${API_BASE_URL}/connectedcar/v4/virtualkey/remoteaccess/token`;
const OTP_MAC_ID = 'bb8e981582b0f31353108fb020bead1c';

/**
 * MQTT Constants
 */
const MQTT_SERVER = 'mwa.mpsa.com';
const MQTT_PORT = 8885;
const MQTT_KEEP_ALIVE = 120;
const MQTT_QOS = 0;
const MQTT_USERNAME = 'IMA_OAUTH_ACCESS_TOKEN';
const MQTT_RESP_TOPIC = 'psa/RemoteServices/to/cid/';
const MQTT_EVENT_TOPIC = 'psa/RemoteServices/events/MPHRTServices/';
const MQTT_REQ_TOPIC = 'psa/RemoteServices/from/cid/';

// The MQTT refresh token is valid for ~3 days; the OTP is only needed when it has expired.
const MQTT_REFRESH_TOKEN_TTL_MS = 3 * 24 * 60 * 60 * 1000;
// Renew the MQTT access token a little before it expires
const MQTT_TOKEN_MARGIN_MS = 3 * 60 * 1000;
const MQTT_CONNECT_TIMEOUT_MS = 20000;
const COMMAND_TIMEOUT_MS = 60000;

// process_code / return_code values
const COMMAND_STATUS_IN_PROGRESS = ['900', '901', '903'];
const COMMAND_STATUS_SUCCESS = ['0', '1'];

/**
 * MQTT TOKEN RESULT
 */
interface MqttTokenResult {
  success: boolean;
  mqttClient?: mqtt.MqttClient;
  error?: string;
  requiresSetup?: boolean;
  otpState?: OtpState;
}

/**
 * MQTT Token Response from API
 */
interface MqttTokenResponse {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expires_in: number;
}

/**
 * Configuration for Stellantis Remote Client
 */
export interface StellantisConfig {
  realm: string;
  clientId: string;
  clientSecret: string;
  countryCode: string;
  locale: string;
  customerId: string;
  accessToken: string;
}

/**
 * Remote command result
 */
interface RemoteCommandResult {
  success: boolean;
  correlationId?: string;
  response?: any;
  error?: string;
}

class CommandError extends Error {
  public code: string;
  public payload: any;

  constructor(code: string, payload: any) {
    super(`Command failed: ${code}`);
    this.name = 'CommandError';
    this.code = code;
    this.payload = payload;
  }
}

type Translate = (key: string, vars?: { [name: string]: string | number }) => string;

// Failure reasons of the car (resp_data), as translation keys (locales: errors.*)
// /ThermalPrecond, /VehCharge*, /Doors, /Horn and /Lights; same codes as the Home Assistant integration.
const THERMAL_PRECOND_KEYS: { [code: number]: string } = {
  0: 'errors.precond_0', 1: 'errors.precond_1', 2: 'errors.precond_2', 3: 'errors.precond_3', 4: 'errors.precond_4'
};
const VEH_CHARGE_KEYS: { [code: number]: string } = {
  0: 'errors.charge_0', 1: 'errors.charge_1', 2: 'errors.charge_2', 3: 'errors.charge_3'
};
const DOORS_STATE_KEYS: { [code: number]: string } = {
  2: 'errors.doors_2', 3: 'errors.doors_3', 4: 'errors.doors_4', 5: 'errors.doors_5'
};
const HORN_KEYS: { [code: number]: string } = { 0: 'errors.horn_0', 1: 'errors.horn_1' };
const LIGHTS_KEYS: { [code: number]: string } = { 0: 'errors.lights_0', 2: 'errors.lights_2' };

function describeCommandError(t: Translate, servicePath: string, error: CommandError): string {
  const respData = error.payload?.resp_data;
  const has = (value: any) => value !== undefined && value !== null;
  let key: string | undefined;

  if (respData) {
    if (servicePath === '/Doors') {
      if (has(respData.error) && Number(respData.error) === 0) {
        key = 'errors.doors_engine';
      } else if (has(respData.lock_resp_state)) {
        key = DOORS_STATE_KEYS[Number(respData.lock_resp_state)];
      }
    } else if (servicePath === '/Horn' && has(respData.error)) {
      key = HORN_KEYS[Number(respData.error)];
    } else if (servicePath === '/Lights' && has(respData.error)) {
      key = LIGHTS_KEYS[Number(respData.error)];
    } else if (servicePath.startsWith('/VehCharge') && has(respData.error)) {
      key = VEH_CHARGE_KEYS[Number(respData.error)];
    } else if (servicePath === '/ThermalPrecond' && has(respData.error)) {
      key = THERMAL_PRECOND_KEYS[Number(respData.error)];
    }
  }

  if (key) {
    return `${t(key)}${t('errors.code_suffix', { code: error.code })}`;
  }

  const reason = error.payload?.reason ? ` - ${error.payload.reason}` : '';
  return `${t('errors.command_failed', { code: error.code })}${reason}`;
}

function describeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response) {
      let data: string;
      try {
        data = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);
      } catch {
        data = String(error.response.data);
      }
      return `HTTP ${error.response.status}: ${data}`;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Stellantis Remote Control Client - OTP + MQTT
 */
export class StellantisRemoteClient {
  private config: StellantisConfig;
  private refreshTokenCallback?: () => Promise<string>;

  private homey: any = null;
  private brandName: string = '';
  private vins: string[] = [];

  private mqttClient: mqtt.MqttClient | null = null;
  private otp: Otp | null = null;
  private pendingRequests: Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  // MQTT token management (persisted in the Homey settings)
  private mqttAccessToken: string | null = null;
  private mqttRefreshToken: string | null = null;
  private mqttTokenExpiresAt: number = 0;
  private mqttRefreshTokenExpiresAt: number = 0;

  // Serialises everything that touches the OTP state / MQTT tokens / MQTT connection
  private lockChain: Promise<unknown> = Promise.resolve();

  constructor(config: StellantisConfig, refreshTokenCallback?: () => Promise<string>) {
    this.config = config;
    this.refreshTokenCallback = refreshTokenCallback;
  }

  getAPIHost() {
    return 'api.groupe-psa.com';
  }

  /**
   * Give the client access to the Homey settings (where the OTP state and MQTT tokens are stored)
   */
  /**
   * Translate a message (locales/<language>.json); falls back to the key when no Homey instance is known yet.
   */
  private t: Translate = (key, vars) => {
    try {
      if (this.homey && typeof this.homey.__ === 'function') {
        return this.homey.__(key, vars);
      }
    } catch {
      // fall through
    }
    return key;
  };

  init(homey: any, brandName: string): void {
    this.homey = homey;
    this.brandName = brandName;
  }

  /**
   * Hand over a fresh OAuth access token (the OAuth token is refreshed by the StellantisClient)
   */
  updateOAuthToken(accessToken: string): void {
    if (accessToken) {
      this.config.accessToken = accessToken;
    }
  }

  /**
   * VINs of the vehicles whose events should be subscribed to
   */
  setVins(vins: string[]): void {
    this.vins = vins.filter(v => !!v);
  }

  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lockChain.then(fn, fn);
    this.lockChain = run.then(() => undefined, () => undefined);
    return run;
  }

  // ==========================================================================
  // HTTP helpers
  // ==========================================================================

  private oauthHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.config.accessToken}`,
      'User-Agent': 'okhttp/4.8.0',
      'Accept': 'application/hal+json',
      'x-introspect-realm': this.config.realm
    };
  }

  private clientQuery(): string {
    return `client_id=${encodeURIComponent(this.config.clientId)}&locale=${encodeURIComponent(this.config.locale)}`;
  }

  /**
   * Refresh OAuth token if callback is provided
   */
  private async ensureFreshOAuthToken(): Promise<void> {
    if (this.refreshTokenCallback) {
      console.log('[OAuth] Refreshing OAuth token...');
      const newToken = await this.refreshTokenCallback();
      this.config.accessToken = newToken;
      console.log('[OAuth] ✓ Token refreshed');
    }
  }

  /**
   * Run an OAuth-authenticated call. On a 401 the OAuth token is refreshed and the call is
   * retried once (the call must read this.config.accessToken itself, via oauthHeaders()).
   */
  private async withOAuthRetry<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401 && this.refreshTokenCallback) {
        console.log('[OAuth] 401 ontvangen, OAuth token verversen en één keer opnieuw proberen');
        await this.ensureFreshOAuthToken();
        return await call();
      }
      throw error;
    }
  }

  /**
   * Step 1: Request OTP SMS
   */
  async requestOTP(): Promise<void> {
    const url = `${GET_OTP_URL}?${this.clientQuery()}`;

    try {
      console.log('\n========================================');
      console.log('STEP 1: Requesting OTP SMS');
      console.log('========================================');
      console.log('URL:', url);

      await this.withOAuthRetry(() => axios.post(url, undefined, {
        headers: this.oauthHeaders(),
        timeout: 30000
      }));

      console.log('✓ SMS requested');
      console.log('========================================\n');
    } catch (error) {
      console.error('✗ Failed to request SMS:', describeError(error));
      throw error;
    }
  }

  /**
   * POST to the remote access token endpoint (grant_type password with OTP, or refresh_token)
   */
  private async requestMqttToken(body: Record<string, string>): Promise<MqttTokenResponse> {
    const url = `${GET_MQTT_TOKEN_URL}?${this.clientQuery()}`;

    console.log(`[MQTT token] grant_type=${body.grant_type} realm=${this.config.realm} locale=${this.config.locale}`);

    try {
      const response = await this.withOAuthRetry(() => axios.post<MqttTokenResponse>(url, body, {
        headers: this.oauthHeaders(),
        timeout: 30000
      }));

      if (!response.data || !response.data.access_token) {
        throw new Error(this.t('errors.no_access_token_mqtt'));
      }

      console.log('[MQTT token] ✓ Success! Expires in:', response.data.expires_in, 'seconds');
      return response.data;
    } catch (error) {
      console.error('[MQTT token] ✗ Failed:', describeError(error));
      throw error;
    }
  }

  // ==========================================================================
  // Persistence of the MQTT tokens
  // ==========================================================================

  private mqttSettingsKey(): string {
    return `stellantis_mqtt_${this.brandName.toLowerCase()}`;
  }

  private otpSettingsKey(): string {
    return `stellantis_tokens_otpState_${this.brandName.toLowerCase()}`;
  }

  private async loadMqttState(): Promise<void> {
    if (this.mqttAccessToken || this.mqttRefreshToken || !this.homey) {
      return;
    }
    const stored = await this.homey.settings.get(this.mqttSettingsKey());
    if (stored && typeof stored === 'object') {
      this.mqttAccessToken = stored.access_token ?? null;
      this.mqttRefreshToken = stored.refresh_token ?? null;
      this.mqttTokenExpiresAt = Number(stored.expires_at) || 0;
      this.mqttRefreshTokenExpiresAt = Number(stored.refresh_expires_at) || 0;
    }
  }

  private async saveMqttState(): Promise<void> {
    if (!this.homey) {
      return;
    }
    await this.homey.settings.set(this.mqttSettingsKey(), {
      access_token: this.mqttAccessToken,
      refresh_token: this.mqttRefreshToken,
      expires_at: this.mqttTokenExpiresAt,
      refresh_expires_at: this.mqttRefreshTokenExpiresAt
    });
  }

  private async clearMqttState(): Promise<void> {
    this.mqttAccessToken = null;
    this.mqttRefreshToken = null;
    this.mqttTokenExpiresAt = 0;
    this.mqttRefreshTokenExpiresAt = 0;
    if (this.homey) {
      await this.homey.settings.unset(this.mqttSettingsKey());
    }
  }

  private applyMqttToken(token: MqttTokenResponse): void {
    this.mqttAccessToken = token.access_token;
    this.mqttTokenExpiresAt = Date.now() + (Number(token.expires_in) * 1000);
    if (token.refresh_token) {
      this.mqttRefreshToken = token.refresh_token;
      this.mqttRefreshTokenExpiresAt = Date.now() + MQTT_REFRESH_TOKEN_TTL_MS;
    }
  }

  // ==========================================================================
  // OTP activation + MQTT token
  // ==========================================================================

  /**
   * Activate a new OTP session with the SMS code and PIN
   */
  private async activateOtp(smsCode: string, pinCode: string): Promise<MqttTokenResult> {
    console.log('[OTP] Geen bestaande sessie gebruiken, nieuwe activatie met SMS code en PIN');

    const deviceIdentifier = `Homey_${this.brandName}/_/${crypto.randomBytes(16).toString('hex')}`;
    const otp = new Otp(OTP_MAC_ID, deviceIdentifier);

    otp['smsCode'] = smsCode;
    otp['codepin'] = pinCode;

    console.log('[OTP] Starten activatie...');
    const activated = await otp.activationStart();

    if (!activated) {
      return {
        success: false,
        error: this.t('errors.otp_activation_failed')
      };
    }

    console.log('[OTP] Finaliseren activatie...');
    const finalizeResult = await otp.activationFinalize();

    if (finalizeResult !== 0) {
      console.error(`[OTP] Finalisatie gefaald met code: ${finalizeResult}`);
      return {
        success: false,
        error: this.t('errors.otp_finalize_failed', { result: String(finalizeResult) })
      };
    }

    console.log('[OTP] ✓ OTP sessie succesvol aangemaakt');
    await this.homey.settings.set(this.otpSettingsKey(), otp.toJSON());
    this.otp = otp;

    return { success: true };
  }

  /**
   * Get a MQTT access token with a freshly generated OTP code.
   * ⚠️ Max 6 times per 24 hours - only used when the MQTT refresh token cannot be used.
   */
  private async mqttTokenViaOtp(): Promise<MqttTokenResult> {
    const settingsKey = this.otpSettingsKey();

    let otp = this.otp;
    if (!otp) {
      const state = await this.homey.settings.get(settingsKey);
      if (!state) {
        return {
          success: false,
          requiresSetup: true,
          error: this.t('errors.otp_no_state')
        };
      }
      try {
        otp = Otp.fromJSON(state);
      } catch {
        await this.homey.settings.unset(settingsKey);
        return {
          success: false,
          requiresSetup: true,
          error: this.t('errors.otp_state_corrupt')
        };
      }
      this.otp = otp;
    }

    console.log('[OTP] OTP code genereren (max 6 keer per 24 uur)...');

    let otpCode: string;
    try {
      otpCode = await otp.getOtpCode();
    } catch (error) {
      // Memory copy may be half updated, reload from the saved state next time
      this.otp = null;

      if (error instanceof ConfigException) {
        console.error('[OTP] ✗ OTP sessie ongeldig:', error.message);
        await this.homey.settings.unset(settingsKey);
        return {
          success: false,
          requiresSetup: true,
          error: this.t('errors.otp_session_expired')
        };
      }

      // Network problem etc.: keep the OTP state, it is probably still valid
      console.error('[OTP] ✗ OTP code genereren mislukt (state blijft bewaard):', describeError(error));
      return {
        success: false,
        error: this.t('errors.otp_generate_failed', { error: describeError(error) })
      };
    }

    if (!otpCode) {
      // The server rejected the challenge (out of sync): same as Home Assistant, ask for re-authentication
      this.otp = null;
      return {
        success: false,
        requiresSetup: true,
        error: this.t('errors.otp_code_empty')
      };
    }

    console.log('[OTP] ✓ OTP code gegenereerd');

    // The OTP counters changed, always save the new state
    const updatedState = otp.toJSON();
    await this.homey.settings.set(settingsKey, updatedState);

    try {
      const token = await this.requestMqttToken({ grant_type: 'password', password: otpCode });
      this.applyMqttToken(token);
      await this.saveMqttState();
      return { success: true, otpState: updatedState };
    } catch (error) {
      return {
        success: false,
        error: this.t('errors.mqtt_token_failed', { error: describeError(error) })
      };
    }
  }

  /**
   * Make sure we have a valid MQTT access token:
   * 1. still valid -> use it
   * 2. MQTT refresh token valid -> refresh (no OTP needed)
   * 3. otherwise -> new OTP code
   */
  private async ensureMqttToken(force: boolean): Promise<MqttTokenResult> {
    await this.loadMqttState();

    const now = Date.now();
    if (!force && this.mqttAccessToken && this.mqttTokenExpiresAt - MQTT_TOKEN_MARGIN_MS > now) {
      return { success: true };
    }

    if (this.mqttRefreshToken && this.mqttRefreshTokenExpiresAt > now) {
      try {
        console.log('[MQTT token] Verversen met refresh_token (geen OTP nodig)');
        const token = await this.requestMqttToken({
          grant_type: 'refresh_token',
          refresh_token: this.mqttRefreshToken
        });
        this.applyMqttToken(token);
        await this.saveMqttState();
        return { success: true };
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status !== 400 && status !== 401 && status !== 403) {
          // Network/server problem: do not burn an OTP, try again later
          return {
            success: false,
            error: this.t('errors.mqtt_refresh_failed', { error: describeError(error) })
          };
        }
        console.warn('[MQTT token] Refresh token geweigerd, nieuwe OTP code aanvragen');
      }
    }

    return this.mqttTokenViaOtp();
  }

  /**
   * Get a MQTT token and connect (without the lock; callers hold it)
   */
  private async connectInternal(forceToken: boolean): Promise<MqttTokenResult> {
    let tokenResult = await this.ensureMqttToken(forceToken);
    if (!tokenResult.success) {
      return tokenResult;
    }

    let result = await this.connectMQTT(this.mqttAccessToken!);

    if (!result.success && result.authFailed && !forceToken) {
      console.log('[MQTT] Token geweigerd door broker, token vernieuwen en opnieuw verbinden');
      tokenResult = await this.ensureMqttToken(true);
      if (!tokenResult.success) {
        return tokenResult;
      }
      result = await this.connectMQTT(this.mqttAccessToken!);
    }

    if (!result.success) {
      return {
        success: false,
        error: this.t('errors.mqtt_connect_failed', { error: String(result.error) })
      };
    }

    return {
      success: true,
      mqttClient: this.mqttClient!
    };
  }

  /**
   * Validate / activate the OTP session and connect to MQTT.
   *
   * - smsCode + pinCode given: a new OTP session is activated
   * - otherwise the saved OTP session / MQTT refresh token is used
   */
  async validateOTP(
    homey: any,
    smsCode: string | null,
    pinCode: string | null,
    brandName: string,
    _clientId: string,
    forceReset: boolean = false
  ): Promise<MqttTokenResult> {
    this.homey = homey;
    this.brandName = brandName;

    return this.runExclusive(async () => {
      homey.log(`Validate OTP`);

      try {
        if (forceReset) {
          await homey.settings.unset(this.otpSettingsKey());
          this.otp = null;
          await this.clearMqttState();
          await this.closeClient();
          console.log('[RESET] OTP state en MQTT tokens gereset');
        }

        if (smsCode && pinCode) {
          const activation = await this.activateOtp(smsCode, pinCode);
          if (!activation.success) {
            return activation;
          }
          // New OTP device -> start with fresh MQTT tokens
          await this.clearMqttState();
        }

        return await this.connectInternal(false);

      } catch (error) {
        console.error('[ERROR]', error);

        if (error instanceof ConfigException) {
          await homey.settings.unset(this.otpSettingsKey());
          this.otp = null;
          return {
            success: false,
            requiresSetup: true,
            error: this.t('errors.otp_config_invalid')
          };
        }

        return {
          success: false,
          error: this.t('errors.unexpected', { error: describeError(error) })
        };
      }
    });
  }

  /**
   * Force a refresh of the MQTT access token
   */
  async refreshMQTTToken(): Promise<boolean> {
    if (!this.homey) {
      console.error('[MQTT REFRESH] Remote client not initialised');
      return false;
    }
    const result = await this.runExclusive(() => this.ensureMqttToken(true));
    return result.success;
  }

  // ==========================================================================
  // MQTT connection
  // ==========================================================================

  /**
   * Connect to MQTT broker with access token and subscribe to the response/event topics
   */
  private connectMQTT(mqttAccessToken: string): Promise<{ success: boolean; error?: string; authFailed?: boolean }> {
    return new Promise((resolve) => {
      // Drop a previous client first
      if (this.mqttClient) {
        try { this.mqttClient.end(true); } catch { /* ignore */ }
        this.mqttClient = null;
      }

      const mqttUrl = `mqtts://${MQTT_SERVER}:${MQTT_PORT}`;

      const mqttOptions: mqtt.IClientOptions = {
        clientId: '',  // Empty for auto-generate
        username: MQTT_USERNAME,
        password: mqttAccessToken,  // MQTT access token, NOT OTP!
        keepalive: MQTT_KEEP_ALIVE,
        clean: true,
        rejectUnauthorized: true,
        protocolVersion: 4,
        connectTimeout: MQTT_CONNECT_TIMEOUT_MS,
        reconnectPeriod: 0
      };

      console.log('[MQTT] Connecting to:', mqttUrl);

      const client = mqtt.connect(mqttUrl, mqttOptions);
      this.mqttClient = client;

      let settled = false;
      const finish = (result: { success: boolean; error?: string; authFailed?: boolean }) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (!result.success) {
          try { client.end(true); } catch { /* ignore */ }
          if (this.mqttClient === client) {
            this.mqttClient = null;
          }
        }
        resolve(result);
      };

      const timer = setTimeout(() => {
        console.log(`[MQTT] ⚠️ Connection timeout (${MQTT_CONNECT_TIMEOUT_MS / 1000}s)`);
        finish({ success: false, error: this.t('errors.mqtt_timeout') });
      }, MQTT_CONNECT_TIMEOUT_MS);

      client.on('connect', () => {
        console.log('[MQTT] ✓ Connected!');

        const respTopic = `${MQTT_RESP_TOPIC}${this.config.customerId}/#`;
        const topics = [respTopic, ...this.vins.map(vin => `${MQTT_EVENT_TOPIC}${vin}`)];

        client.subscribe(topics, { qos: MQTT_QOS }, (err: any, granted: any) => {
          if (err) {
            console.error('[MQTT] Subscription failed:', err.message);
            finish({ success: false, error: this.t('errors.mqtt_subscription_failed', { error: err.message }) });
            return;
          }

          const denied: string[] = (granted || []).filter((g: any) => g.qos === 128).map((g: any) => g.topic);
          if (denied.includes(respTopic)) {
            console.error('[MQTT] Subscribe geweigerd voor', respTopic);
            finish({
              success: false,
              error: this.t('errors.subscribe_refused', { topic: respTopic })
            });
            return;
          }
          if (denied.length > 0) {
            console.warn('[MQTT] Subscribe geweigerd voor event topics:', denied.join(', '));
          }

          console.log(`[MQTT] ✓ Subscribed to ${topics.length} topic(s)`);
          topics.forEach(t => console.log(`[MQTT]   - ${t}`));
          finish({ success: true });
        });
      });

      client.on('error', (error: any) => {
        console.error('[MQTT] Error:', error.message);
        if (!settled) {
          // CONNACK return codes 4 (bad user/password) and 5 (not authorized): the token was rejected
          const authFailed = error && (error.code === 4 || error.code === 5);
          finish({ success: false, error: error.message, authFailed });
        }
      });

      client.on('close', () => {
        console.log('[MQTT] Connection closed');
        if (!settled) {
          finish({ success: false, error: this.t('errors.mqtt_closed') });
        }
      });

      client.on('message', (topic: string, message: Buffer) => {
        this.handleMqttMessage(topic, message);
      });
    });
  }

  /**
   * Handle MQTT messages
   */
  private handleMqttMessage(topic: string, message: Buffer): void {
    try {
      const payload = JSON.parse(message.toString());

      if (!topic.startsWith(MQTT_RESP_TOPIC)) {
        // Vehicle events are not handled (yet)
        console.log('[MQTT] Event on', topic);
        return;
      }

      const correlationId = payload.correlation_id || payload.correlationId;
      const rawCode = payload.return_code ?? payload.process_code;
      console.log('[MQTT] Response on', topic, 'correlation_id:', correlationId, 'code:', rawCode);

      if (!correlationId || rawCode === undefined || rawCode === null) {
        return;
      }

      const request = this.pendingRequests.get(correlationId);
      if (!request) {
        return;
      }

      const code = String(rawCode);

      if (COMMAND_STATUS_IN_PROGRESS.includes(code)) {
        // Accepted / vehicle asleep / forwarded: the final result follows
        return;
      }

      clearTimeout(request.timeout);
      this.pendingRequests.delete(correlationId);

      if (COMMAND_STATUS_SUCCESS.includes(code)) {
        request.resolve(payload);
      } else {
        request.reject(new CommandError(code, payload));
      }
    } catch (error) {
      console.error('[MQTT] Parse error:', error);
    }
  }

  // ==========================================================================
  // Commands
  // ==========================================================================

  /**
   * Make sure the MQTT token is valid and the client connected
   */
  private async prepareConnection(forceToken: boolean): Promise<MqttTokenResult> {
    if (!this.homey) {
      return {
        success: false,
        error: this.t('errors.remote_not_initialized')
      };
    }

    if (!forceToken && this.isConnected()) {
      return this.ensureMqttToken(false);
    }

    return this.connectInternal(forceToken);
  }

  private publishCommand(servicePath: string, vin: string, correlationId: string, reqParameters: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.mqttClient || !this.mqttClient.connected) {
        reject(new Error(this.t('errors.mqtt_not_connected')));
        return;
      }

      const topic = `${MQTT_REQ_TOPIC}${this.config.customerId}${servicePath}`;
      const payload = JSON.stringify({
        access_token: this.mqttAccessToken,
        customer_id: this.config.customerId,
        correlation_id: correlationId,
        req_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        vin: vin,
        req_parameters: reqParameters
      });

      console.log('[MQTT] Sending command to', topic, 'correlation_id:', correlationId);

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error(this.t('errors.command_timeout')));
      }, COMMAND_TIMEOUT_MS);

      this.pendingRequests.set(correlationId, { resolve, reject, timeout });

      this.mqttClient.publish(topic, payload, { qos: MQTT_QOS, retain: false }, (error) => {
        if (error) {
          clearTimeout(timeout);
          this.pendingRequests.delete(correlationId);
          reject(new Error(this.t('errors.publish_failed', { error: error.message })));
        }
      });
    });
  }

  /**
   * Send a remote command.
   *
   * @param vin      VIN of the vehicle
   * @param service  Remote service path, e.g. '/ThermalPrecond', '/Doors', '/Horn', '/Lights', '/Charge'
   * @param reqParameters  The service parameters (req_parameters), e.g. { action: 'lock' }
   */
  async sendRemoteCommand(
    vin: string,
    service: string,
    reqParameters: any = {}
  ): Promise<RemoteCommandResult> {
    const servicePath = service.startsWith('/') ? service : `/${service}`;
    const timestamp = new Date().toISOString().replace(/\D/g, '').substring(0, 17);
    const correlationId = crypto.randomBytes(16).toString('hex') + timestamp;

    for (let attempt = 0; attempt < 2; attempt++) {
      const forceToken = attempt > 0;
      const ready = await this.runExclusive(() => this.prepareConnection(forceToken));
      if (!ready.success) {
        return {
          success: false,
          correlationId,
          error: ready.error
        };
      }

      try {
        const response = await this.publishCommand(servicePath, vin, correlationId, reqParameters);
        return {
          success: true,
          correlationId,
          response
        };
      } catch (error) {
        const noMatchingKey = error instanceof CommandError &&
          String(error.payload?.reason || '').includes('no.matching.service.key');

        if (error instanceof CommandError && error.code === '400' && !noMatchingKey && attempt === 0) {
          console.log('[MQTT] Code 400: MQTT token lijkt ongeldig, token vernieuwen en opnieuw versturen');
          continue;
        }

        return {
          success: false,
          correlationId,
          error: error instanceof CommandError
            ? describeCommandError(this.t, servicePath, error)
            : (error instanceof Error ? error.message : String(error))
        };
      }
    }

    return {
      success: false,
      correlationId,
      error: this.t('errors.command_failed', { code: '-' })
    };
  }

  // ==========================================================================
  // Connection management
  // ==========================================================================

  private closeClient(): Promise<void> {
    return new Promise((resolve) => {
      const client = this.mqttClient;
      this.mqttClient = null;
      if (client) {
        client.end(true, {}, () => {
          console.log('[MQTT] Disconnected');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Disconnect MQTT
   */
  async disconnect(): Promise<void> {
    await this.closeClient();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.mqttClient !== null && this.mqttClient.connected;
  }

  /**
   * Reconnect if needed. Uses the saved MQTT tokens; a new OTP code is only generated
   * when the MQTT refresh token is no longer usable.
   */
  async reconnectIfNeeded(homey: any, brandName: string, _clientId: string): Promise<boolean> {
    this.homey = homey;
    this.brandName = brandName;

    if (this.isConnected()) {
      return true;
    }

    console.log('[MQTT] Not connected, reconnecting...');
    const result = await this.runExclusive(() => this.connectInternal(false));
    return result.success;
  }
}
