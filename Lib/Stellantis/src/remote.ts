import * as crypto from 'crypto';
import * as mqtt from 'mqtt';
import axios, { AxiosRequestConfig } from 'axios';
import { Otp, ConfigException } from './otp'
import type { OtpState } from './otp'
import Homey from 'homey';


/**
 * MQTT TOKEN RESULT
 */
interface MqttTokenResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  otpCode?: string;
  error?: string;
  requiresSetup?: boolean;
  otpState?: OtpState;  // Nieuwe state om in sessie op te slaan
}

/**
 * OPTIONS
 */
interface OtpOptions {
  otpState?: OtpState;     // Bestaande state uit sessie
  smsCode?: string;        // Voor eerste keer setup
  pinCode?: string;        // Voor eerste keer setup
  clientId: string;
  baseUrl?: string;
}

/**
 * Configuration for Stellantis Remote Client
 */
export interface StellantisConfig {
  realm: string;
  clientId: string;
  clientSecret: string;
  countryCode: string;
  customerId: string;
  accessToken: string;
}

/**
 * Remote credentials returned after OTP validation
 */
export interface RemoteCredentials {
  refreshToken: string | null;
  accessToken: string | null;
  expiresAt: number | null;
}

/**
 * Command payload for remote commands
 */
export interface CommandPayload {
  vin: string;
  action?: string;
  percentage?: number;
  temperature?: number;
  [key: string]: any;
}

/**
 * OTP Response from API
 */
interface OTPResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  err?: string;
  newversion?: string | null;
  newversionurl?: string | null;
}

/**
 * Stellantis Remote Control Client - OTP Authentication
 * Based on PSA Car Controller implementation
 * Handles OTP flow for remote commands (charging, climate control, etc.)
 */
export class StellantisRemoteClient {
  private config: StellantisConfig;
  private remoteCredentials: RemoteCredentials;
  private mqttClient: mqtt.MqttClient | null;

  constructor(config: StellantisConfig) {
    this.config = config;
    this.remoteCredentials = {
      refreshToken: null,
      accessToken: null,
      expiresAt: null
    };
    this.mqttClient = null;
  }

  getAPIHost() {
    return 'api.groupe-psa.com';
  }
  /**
   * Step 1: Request OTP SMS
   * This triggers an SMS to be sent to the phone number associated with the account
   */
  async requestOTP(): Promise<void> {
    
    const apiHost = this.getAPIHost();
    const url = `https://${apiHost}/applications/cvs/v4/mobile/smsCode`;
    
    const params = new URLSearchParams({
      client_id: this.config.clientId
    });
    
    try {
      console.log('\n========================================');
      console.log('STEP 1: Requesting OTP SMS');
      console.log('========================================');
      console.log('URL:', `${url}?${params.toString()}`);
      
      const response = await axios({
        method: 'POST',
        url: `${url}?${params.toString()}`,
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json'
        },
        data: {},
        timeout: 30000
      });
      
      console.log('✓ SMS requested (status 202)');
      //console.log('Response:', response);
      console.log('========================================\n');
      
      return response.data;
      
    } catch (error) {
      console.error('✗ Failed to request SMS');
      console.log(error);
      if (axios.isAxiosError(error) && error.response) {
        console.error('Status:', error.response.status);
        console.error('Error:', error.response.data);
      }
      
      throw error;
    }
  }

  /**
   * Step 2: Validate OTP Code with PIN
   * @param smsCode - 4-digit code received via SMS
   * @param pin - 4-digit PIN from mobile app
   */
  async validateOTP(homey:Homey.App, smsCode: string, pinCode:string, brandName:string, clientId:string): Promise<any> {
    let otpState = await homey.homey.settings.get('stellantis_tokens_otpState_' + brandName.toLowerCase());
    let baseUrl = 'https://mw-web-bff.mpsa.com';

  try {
    // ========================================================================
    // STAP 2 & 3: OTP OBJECT VERKRIJGEN (uit sessie of nieuw aanmaken)
    // ========================================================================
    
    let otp: Otp | null = null;
    
    // Probeer eerst uit sessie te laden
    if (otpState) {
      console.log('[STAP 3] OTP laden uit sessie...');
      otp = Otp.fromJSON(otpState);
      console.log('[STAP 3] ✓ OTP object succesvol geladen uit sessie');
    } 
    // Als geen state in sessie, maak nieuwe aan (STAP 2)
    else {
      console.log('[STAP 2] Geen OTP state in sessie, nieuwe sessie aanmaken...');
      
      // Check of SMS code en PIN zijn meegegeven
      if (!smsCode || !pinCode) {
        return {
          success: false,
          requiresSetup: true,
          error: 'Geen OTP state in sessie. SMS code en PIN vereist voor setup.'
        };
      }
      
      console.log(`[STAP 2] Aanmaken met SMS: ${smsCode}, PIN: ${pinCode.replace(/./g, '*')}`);
      
      // Maak nieuw OTP object
      otp = new Otp('bb8e981582b0f31353108fb020bead1c', 'Homey_' + brandName);
      otp['smsCode'] = smsCode;
      otp['codepin'] = pinCode;
      
      // Activeer
      const activated = await otp.activationStart();

      if (!activated) {
        return {
          success: false,
          error: 'OTP activatie gefaald. Controleer SMS code en PIN.'
        };
      }
      
      const finalizeResult = await otp.activationFinalize();
      console.log(finalizeResult);
      if (finalizeResult !== 0) { // 0 = OK
        return {
          success: false,
          error: `OTP activatie finalisatie gefaald: ${finalizeResult}`
        };
      }
      
      console.log('[STAP 2] ✓ OTP sessie succesvol aangemaakt');
    }

    // ========================================================================
    // STAP 4: OTP CODE GENEREREN
    // ========================================================================
    
    console.log('[STAP 4] OTP code genereren...');
    console.log('[STAP 4] ⚠️  Rate limit: Max 6 keer per 24 uur');
    
    const otpCode = await otp.getOtpCode();
    
    if (!otpCode) {
      return {
        success: false,
        error: 'OTP code generatie gefaald. Mogelijk opnieuw authenticeren vereist.'
      };
    }
    
    console.log(`[STAP 4] ✓ OTP code gegenereerd: ${otpCode}`);

    // ========================================================================
    // STAP 5: MQTT TOKEN VERKRIJGEN MET OTP CODE
    // ========================================================================
    
    console.log('[STAP 5] MQTT token aanvragen met OTP code...');
    
    const tokenUrl = `${baseUrl}/v1/oauth/token`;
    const response = await axios.post(
      tokenUrl,
      {
        grant_type: 'password',
        password: otpCode
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-introspect-realm': 'INTROSPECT_REALM'
        },
        params: {
          client_id: clientId
        }
      }
    );

    console.log('[STAP 5] ✓ MQTT token succesvol verkregen');
    console.log(`[STAP 5]   Access token: ${response.data.access_token.substring(0, 30)}...`);
    console.log(`[STAP 5]   Verloopt over: ${response.data.expires_in} seconden`);

    // ========================================================================
    // RESULTAAT + NIEUWE STATE VOOR SESSIE
    // ========================================================================
    
    // Serialize OTP state om in sessie op te slaan
    const newOtpState = otp.toJSON();

    await homey.homey.settings.set('stellantis_tokens_otpState_' + brandName.toLowerCase(), newOtpState);
    
    return {
      success: true,
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in,
      otpCode: otpCode,
      otpState: newOtpState  // ← Sla dit op in je sessie!
    };

  } catch (error) {
    // Error handling
    if (error instanceof ConfigException) {
      return {
        success: false,
        requiresSetup: true,
        error: 'OTP configuratie is ongeldig. Re-authenticatie vereist.'
      };
    }

    if (axios.isAxiosError(error)) {
      return {
        success: false,
        error: `MQTT token request gefaald: ${error.response?.data?.error_description || error.message}`
      };
    }

    return {
      success: false,
      error: `Onverwachte fout: ${(error as Error).message}`
    };
  }
}
}