import crypto from 'crypto';
import axios, { AxiosProxyConfig } from 'axios';
import { XMLParser } from 'fast-xml-parser';
import forge from 'node-forge';

// Constants
const TIMEOUT_IN_MS = 10000;
const K_PUB = '11';
const EXPONENT = parseInt(K_PUB, 16);
const IW_HOST = 'https://otp.mpsa.com';

const BASE36_CHARS = [
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
];

enum OtpMode {
  ACTIVATE = 'activate',
  OTP = 'otp',
  MS = 'ms'
}

enum OtpResult {
  OK = 0,
  NOK = -1,
  OTP_TWICE = 10
}

export class ConfigException extends Error {
  constructor(message: string | object) {
    super(typeof message === 'string' ? message : JSON.stringify(message));
    this.name = 'ConfigException';
  }
}

interface RValues {
  R0: string;
  R1: string;
  R2: string;
}

interface XmlResponse {
  err: string;
  Kiw?: string;
  Kfact?: string;
  pinmode?: string;
  challenge?: string;
  defi?: string;
  J?: any;
  ms_n?: string | number;
  ms_key?: string;
  ms_id?: string;
  s_id?: string;
  tsync?: string;
  id?: string;
  [key: string]: any;
}

export interface OtpState {
  Kiw: string | null;
  pinmode: string | null;
  Kfact: string | null;
  needsync: any;
  serviceid: any;
  alias: any;
  iwalea: string;
  device_id: string;
  codepin: string | null;
  challenge: string;
  action: string;
  s_id: string | null;
  version: string;
  isMac: boolean;
  macid: string;
  smsCode: string | null;
  mode: OtpMode;
  defi: number;
  otp_count: number;
  data: IWData;
}

class IWData {
  iwid: string;
  iwTsync: string;
  iwK0: string;
  iwK1: string;
  iwsecid: string;
  iwsecval: string;
  iwsecn: number;
  private parent: Otp;

  constructor(parent: Otp) {
    this.parent = parent;
    this.iwid = '';
    this.iwTsync = '0';
    this.iwK0 = '';
    this.iwK1 = '';
    this.iwsecid = '';
    this.iwsecval = '';
    this.iwsecn = 0;
  }

  synchro(xml: XmlResponse, kma: string): void {
    // Update sync timestamp
    if (xml.tsync) {
      this.iwTsync = xml.tsync;
    }
    
    // Update ID
    if (xml.id) {
      this.iwid = xml.id;
    }
    
    // CRITICAL: Set iwK0 from KMA on first sync
    // iwK0 is used for generating R values
    if (!this.iwK0) {
      this.iwK0 = kma;
      console.debug('iwK0 initialized:', this.iwK0.substring(0, 32));
    }
    
    // iwK1 is set from the encrypted session value or from K0
    if (!this.iwK1) {
      this.iwK1 = kma;
      console.debug('iwK1 initialized:', this.iwK1.substring(0, 32));
    }
  }
}

function numberToBase36(n: number): string {
  if (n === 0) return '0';
  
  let digits = '';
  let num = n;
  
  while (num > 0) {
    digits += BASE36_CHARS[Math.floor(num % 36)];
    num = Math.floor(num / 36);
  }
  
  return digits;
}

function generateRandomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

function sha256Hash(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf-8').digest('hex');
}

// MGF1 - Mask Generation Function
function mgf1(seed: Buffer, length: number, hashAlgo: string = 'sha256'): Buffer {
  const hLen = hashAlgo === 'sha256' ? 32 : 20;
  const T: Buffer[] = [];
  const counter = Math.ceil(length / hLen);

  for (let i = 0; i < counter; i++) {
    const C = Buffer.alloc(4);
    C.writeUInt32BE(i, 0);
    const hash = crypto.createHash(hashAlgo);
    hash.update(seed);
    hash.update(C);
    T.push(hash.digest());
  }

  return Buffer.concat(T).slice(0, length);
}

// XOR two buffers
function xorBuffers(a: Buffer, b: Buffer): Buffer {
  const result = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
}

// OAEP DECRYPT using public exponent
function oaepDecrypt(ciphertext: Buffer, modulus: forge.jsbn.BigInteger, exponent: forge.jsbn.BigInteger, label: Buffer = Buffer.alloc(0)): Buffer {
  const k = Math.ceil(modulus.bitLength() / 8);
  const hLen = 32; // SHA-256

  if (ciphertext.length !== k) {
    throw new Error(`Ciphertext with incorrect length. Expected ${k}, got ${ciphertext.length}`);
  }

  const ctInt = new forge.jsbn.BigInteger(ciphertext.toString('hex'), 16);
  const mInt = ctInt.modPow(exponent, modulus);

  let emHex = mInt.toString(16);
  while (emHex.length < k * 2) {
    emHex = '0' + emHex;
  }
  const em = Buffer.from(emHex, 'hex');

  const lHash = crypto.createHash('sha256').update(label).digest();
  const y = em[0];
  const maskedSeed = em.slice(1, hLen + 1);
  const maskedDb = em.slice(hLen + 1);

  const seedMask = mgf1(maskedDb, hLen);
  const seed = xorBuffers(maskedSeed, seedMask);
  const dbMask = mgf1(seed, k - hLen - 1);
  const db = xorBuffers(maskedDb, dbMask);

  const dbData = db.slice(hLen);
  const onePos = dbData.indexOf(0x01);
  
  if (onePos < 0) {
    throw new Error('Incorrect decryption - no separator found');
  }

  return db.slice(hLen + onePos + 1);
}

function decodeOaep(enc: string, key: string): string {
  const blockSize = 128;
  let decString = '';
  const encBuffer = Buffer.from(enc, 'hex');
  const nbBlock = Math.ceil(encBuffer.length / blockSize);

  const modulus = new forge.jsbn.BigInteger(key, 16);
  const exp = new forge.jsbn.BigInteger(EXPONENT.toString(), 10);

  for (let x = 0; x < nbBlock; x++) {
    const mini = x * 128;
    const maxi = x === nbBlock - 1 ? encBuffer.length : (1 + x) * 128;
    const block = encBuffer.slice(mini, maxi);
    const decrypted = oaepDecrypt(block, modulus, exp);
    decString += decrypted.toString('hex');
  }

  console.debug('Decoded OAEP:', decString);
  return decString;
}

class OAEPCipher {
  private publicKey: forge.pki.rsa.PublicKey;

  constructor(modulusHex: string, exponent: number) {
    const n = new forge.jsbn.BigInteger(modulusHex, 16);
    const e = new forge.jsbn.BigInteger(exponent.toString(), 10);
    this.publicKey = forge.pki.rsa.setPublicKey(n, e);
  }

  encrypt(plaintext: Buffer): Buffer {
    const plaintextBinary = plaintext.toString('binary');
    const encrypted = this.publicKey.encrypt(plaintextBinary, 'RSA-OAEP', {
      md: forge.md.sha256.create(),
      mgf1: { md: forge.md.sha256.create() }
    });
    return Buffer.from(encrypted, 'binary');
  }
}

export class Otp {
  private static proxies: AxiosProxyConfig | null = null;

  private Kiw: string | null = null;
  private pinmode: string | null = null;
  private Kfact: string | null = null;
  private needsync: any = null;
  private serviceid: any = null;
  private alias: any = null;
  private iwalea: string;
  private device_id: string;
  private codepin: string | null = null;
  private challenge: string = '';
  private action: string = '';
  private s_id: string | null = null;
  private version: string = '0.2.11';
  private isMac: boolean = true;
  private data: IWData;
  private cipher: OAEPCipher | null = null;
  private macid: string;
  private smsCode: string | null = null;
  private mode: OtpMode = OtpMode.ACTIVATE;
  private defi: number = 0;
  private otp_count: number = 0;
  private xmlParser: XMLParser;

  constructor(inweboAccessId: string, deviceId?: string) {
    this.iwalea = generateRandomHex(16);
    this.device_id = deviceId || generateRandomHex(8);
    this.data = new IWData(this);
    this.macid = inweboAccessId;
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@'
    });
  }

  init(Kfact: string, Kiw: string, pinmode: string): void {
    this.Kfact = Kfact;
    this.pinmode = pinmode;
    this.Kiw = decodeOaep(Kiw, Kfact);
    this.cipher = new OAEPCipher(this.Kiw, EXPONENT);
  }

  getSerial(): string {
    return `${this.device_id}/_/${this.iwalea}`;
  }

  generateKma(codepin: string): string {
    const serial = this.getSerial();
    const kmaStr = `${codepin};${serial}`;
    const kma = sha256Hash(kmaStr).substring(0, 32);
    return kma;
  }

  private getR(): RValues {
    let iw: string;
    
    if (this.action === 'upgrade') {
      iw = this.data.iwK1;
    } else {
      iw = this.data.iwK0;
    }

    let R2: string;
    if (this.action === 'synchro') {
      R2 = `${this.challenge};${iw};${this.codepin}`;
    } else {
      R2 = `${this.challenge};${iw};`;
    }

    const R0 = `${this.challenge};${iw};${this.getSerial()}`;
    const R1 = `${this.challenge};${iw};${this.data.iwK1}`;

    console.debug(`R0: ${R0}\nR1: ${R1}\nR2: ${R2}`);

    return {
      R0: sha256Hash(R0),
      R1: sha256Hash(R1),
      R2: sha256Hash(R2)
    };
  }

  private async request(params: Record<string, any>, setup = false): Promise<XmlResponse> {
    const response = await axios.get(`${IW_HOST}/iwws/MAC`, {
      headers: {
        'Connection': 'Keep-Alive',
        'Host': 'otp.mpsa.com',
        'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 8.0.0; Android SDK built for x86_64 Build/OSR1.180418.004)'
      },
      params,
      proxy: Otp.proxies || undefined,
      timeout: TIMEOUT_IN_MS
    });

    let rawXml = response.data;
    const xmlStart = rawXml.indexOf('?>');
    if (xmlStart !== -1) {
      rawXml = rawXml.substring(xmlStart + 2);
    }

    const parsed = this.xmlParser.parse(rawXml);
    const result = setup ? parsed.ActionSetup : parsed.ActionFinalize;

    if (!result) {
      console.debug(rawXml);
      throw new Error('Bad response from server');
    }

    return result;
  }

  async activationStart(): Promise<boolean> {
    const params: Record<string, any> = {
      action: 'ActionSetup',
      mode: this.mode,
      id: this.data.iwid,
      lastsync: this.data.iwTsync,
      version: 'Generator-1.0/0.2.11',
      macid: this.macid
    };

    if (this.mode === OtpMode.OTP) {
      params.sid = this.data.iwsecid;
    } else if (this.mode === OtpMode.ACTIVATE) {
      params.code = this.smsCode;
    }

    const xml = await this.request(params, true);

    if (xml.err === 'OK') {
      if (this.mode === OtpMode.ACTIVATE) {
        this.init(xml.Kfact!, xml.Kiw!, xml.pinmode!);
        // CRITICAL: Initialize iwK0 and iwK1 IMMEDIATELY after init
        const kma = this.generateKma(this.codepin!);
        this.data.iwK0 = kma;
        this.data.iwK1 = kma;
        console.debug('Initialized after setup - iwK0:', this.data.iwK0.substring(0, 32));
      } else if (this.mode === OtpMode.OTP) {
        this.challenge = xml.challenge!;
      }
      return true;
    }

    throw new ConfigException(xml);
  }

  async activationFinalize(randomBytes?: Buffer): Promise<OtpResult> {
    const R = this.getR();
    const params: Record<string, any> = {
      action: 'ActionFinalize',
      mode: this.mode,
      id: this.data.iwid,
      lastsync: this.data.iwTsync,
      version: 'Generator-1.0/0.2.11',
      lang: 'fr',
      ack: '',
      macid: this.macid,
      ...R
    };

    if (this.mode === OtpMode.OTP) {
      params.keytype = '0';
      params.sid = this.data.iwsecid;
    } else if (this.mode === OtpMode.ACTIVATE) {
      if (!this.cipher || !this.codepin) {
        throw new Error('Cipher or codepin not initialized');
      }

      const kma = this.generateKma(this.codepin);
      const kmaCrypt = this.cipher.encrypt(Buffer.from(kma, 'hex')).toString('hex');
      const pinCrypt = this.cipher.encrypt(Buffer.from(this.codepin, 'utf-8')).toString('hex');
      
      params.serial = this.getSerial();
      params.code = this.smsCode;
      params.Kma = kmaCrypt;
      params.pin = pinCrypt;
      params.name = 'Android SDK built for x86_64 / UNKNOWN';
    }

    const xml = await this.request(params);

    if (xml.err !== 'OK') {
      console.error('Error during activation:', xml);
      return OtpResult.NOK;
    }

    this.data.synchro(xml, this.generateKma(this.codepin!));

    if (this.mode === OtpMode.OTP) {
      if (!xml.defi) {
        throw new ConfigException('Missing defi in response');
      }
      this.defi = parseInt(xml.defi);

      if (xml.J) {
        console.debug('Need another otp request');
        return OtpResult.OTP_TWICE;
      }
      return OtpResult.OK;
    }

    if (!xml.ms_n || xml.ms_n == 0) {
      console.debug('no ms_n request needed');
      return OtpResult.OK;
    }

    if (parseInt(xml.ms_n as string) > 1) {
      throw new Error('Multiple ms_n not implemented');
    }

    const msN = '0';
    this.challenge = xml.challenge!;
    this.action = 'synchro';

    const res = decodeOaep(xml.ms_key!, this.Kfact!);
    const tempCipher = new OAEPCipher(res, EXPONENT);

    const randomBytesData = randomBytes || crypto.randomBytes(16);
    const kpubEncode = tempCipher.encrypt(randomBytesData);

    const aesCipher = crypto.createCipheriv(
      'aes-128-ecb',
      Buffer.from(this.generateKma(this.codepin!), 'hex'),
      Buffer.alloc(0)
    );
    aesCipher.setAutoPadding(false);
    const encodeAesFromHex = aesCipher.update(randomBytesData).toString('hex');

    this.data.iwsecval = encodeAesFromHex;
    this.data.iwsecid = xml.s_id!;
    this.data.iwsecn = 1;

    const reqParam: Record<string, any> = {
      action: 'ActionFinalize',
      mode: OtpMode.MS,
      [`ms_id${msN}`]: xml.ms_id,
      [`ms_val${msN}`]: kpubEncode.toString('hex'),
      macid: this.macid,
      id: this.data.iwid,
      lastsync: this.data.iwTsync,
      ms_n: 1,
      ...this.getR()
    };

    const xml2 = await this.request(reqParam);
    this.data.synchro(xml2, this.generateKma(this.codepin!));

    return OtpResult.OK;
  }

  private _getOtpCode(): string {
    const password = `${this.data.iwK1}:${this.defi}:${this.data.iwsecval}`;
    const res = crypto.createHash('sha256').update(password, 'utf-8').digest();

    const first4Bytes = res.readUInt32BE(0);
    const next4Bytes = res.readUInt32BE(4);
    
    const nb = ((first4Bytes & 0xfffffff) * 1024) + (next4Bytes & 1023);
    const otp = numberToBase36(nb);

    return otp;
  }

  async getOtpCode(): Promise<string | null> {
    this.mode = OtpMode.OTP;
    let otpCode: string | null = null;

    try {
      if (await this.activationStart()) {
        const res = await this.activationFinalize();
        
        if (res !== OtpResult.NOK) {
          if (res === OtpResult.OTP_TWICE) {
            this.mode = OtpMode.OTP;
            await this.activationStart();
            const secondRes = await this.activationFinalize();
            
            if (secondRes !== OtpResult.OK) {
              throw new Error('Second OTP finalization failed');
            }
          }
          
          otpCode = this._getOtpCode();
          
          if (!otpCode) {
            throw new Error('OTP code is null');
          }
          
          console.debug('otp code:', otpCode);
        }
      }
    } catch (error) {
      throw new ConfigException('Cannot get otp code: ' + (error as Error).message);
    }

    return otpCode;
  }

  toJSON(): OtpState {
    return {
      Kiw: this.Kiw,
      pinmode: this.pinmode,
      Kfact: this.Kfact,
      needsync: this.needsync,
      serviceid: this.serviceid,
      alias: this.alias,
      iwalea: this.iwalea,
      device_id: this.device_id,
      codepin: this.codepin,
      challenge: this.challenge,
      action: this.action,
      s_id: this.s_id,
      version: this.version,
      isMac: this.isMac,
      macid: this.macid,
      smsCode: this.smsCode,
      mode: this.mode,
      defi: this.defi,
      otp_count: this.otp_count,
      data: this.data
    };
  }

  static fromJSON(state: OtpState): Otp {
    const otp = new Otp(state.macid, state.device_id);
    Object.assign(otp, state);
    
    if (otp.Kiw) {
      otp.cipher = new OAEPCipher(otp.Kiw, EXPONENT);
    }
    
    return otp;
  }

  static setProxies(proxies: AxiosProxyConfig): void {
    Otp.proxies = proxies;
  }
}