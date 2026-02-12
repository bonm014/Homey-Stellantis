// types.ts - Shared TypeScript interfaces

export interface AuthData {
    brand: string;
    country: string;
    authCode: string;
    client_id: string;
    client_secret: string;
    oauth_url: string;
    redirect_uri: string;
    state: string;
    timestamp: number;
    mfa_token?: string;  // Optional MFA token for 2FA flow
}

export interface TokenData {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    expiresAt: number;
    brand: string;
    country: string;
    client_id: string;
    client_secret: string;
    oauth_url: string;
    createdAt: number;
    lastRefresh: number;
}

export interface StellantisClient {
    brand: string;
    country: string;
    oauth_url: string;
    clientid:string;
    clientSecret:string;
    getAccessToken: () => Promise<string>;
}

// API Response types
export interface ApiSuccessResponse {
    success: true;
    expiresAt: number;
}

export interface ApiErrorResponse {
    success: false;
    error: string;
}

export interface ApiOtpRequiredResponse {
    otp_required: true;
    mfa_token?: string;
}

export type ApiResponse = ApiSuccessResponse | ApiErrorResponse | ApiOtpRequiredResponse;

// API Arguments
export interface ApiArgs {
    homey: any; // Homey type from 'homey' package
    body?: any;
    query?: any;
    params?: any;
}

// Stellantis OAuth Response
export interface StellantisTokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    error?: string;
}

// Brand Configuration
export interface BrandConfig {
    oauth_url: string;
    realm: string;
    scheme: string;
    configs: {
        [country: string]: CountryConfig;
    };
}

export interface CountryConfig {
    locale: string;
    client_id: string;
    client_secret: string;
}