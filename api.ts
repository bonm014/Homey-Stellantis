// api.ts - Homey API Endpoints (TypeScript)
// Handles communication between settings page and app

import Homey from 'homey';
import fetch from 'node-fetch';
import { AuthData, TokenData, ApiResponse, ApiArgs } from './types';

module.exports = {
    
    /**
     * Exchange authorization code for access token
     * Called from settings page after user provides auth code
     */
    async exchangeToken({ homey }: ApiArgs): Promise<ApiResponse> {
        homey.app.log('API: Exchange authorization code for token');
        
        try {
            // Get auth data from settings store
            const authData = homey.settings.get('auth_data') as AuthData | undefined;
            
            if (!authData || !authData.authCode) {
                throw new Error('No authorization code found in store');
            }
            
            homey.app.log('Making token request to:', authData.oauth_url);
            
            // Create Basic Auth header (base64 encoded client_id:client_secret)
            const credentials = Buffer.from(`${authData.client_id}:${authData.client_secret}`).toString('base64');
            
            const response = await fetch(`${authData.oauth_url}/am/oauth2/access_token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${credentials}`
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: authData.authCode,
                    redirect_uri: authData.redirect_uri
                })
            });
            
            const responseText = await response.text();
            homey.app.log('Token response status:', response.status);
            homey.app.log('Token response headers:', JSON.stringify(response.headers.raw()));
            homey.app.log('Token response body (full):', responseText);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${responseText}`);
            }
            
            const data = JSON.parse(responseText);
            homey.app.log('Parsed token data:', JSON.stringify(data, null, 2));
            
            // Log wat we ontvangen
            if (data.access_token) {
                homey.app.log('access_token type:', typeof data.access_token);
                homey.app.log('access_token length:', data.access_token.length);
                homey.app.log('access_token preview:', data.access_token.substring(0, 50));
                homey.app.log('Is JWT?:', data.access_token.startsWith('eyJ'));
            } else {
                homey.app.error('❌ No access_token in response!');
                homey.app.error('Response keys:', Object.keys(data));
            }
            
            // Check for OTP in response
            if (data.error === 'otp_required' || data.error === 'verification_required') {
                homey.app.log('OTP required (error in response)');
                return { otp_required: true };
            }
            
            if (!data.access_token) {
                homey.app.log('No access_token found, might be 2FA flow');
                // Check if this is a 2FA intermediate response
                if (data.mfaToken || data.mfa_token) {
                    const mfaToken = data.mfaToken || data.mfa_token;
                    homey.app.log('MFA token received, SMS should be sent');
                    
                    // Save MFA token to auth_data for OTP step
                    const authData = homey.settings.get('auth_data') as AuthData | undefined;
                    if (authData) {
                        homey.settings.set('auth_data', {
                            ...authData,
                            mfa_token: mfaToken
                        });
                    }
                    
                    return { otp_required: true, mfa_token: mfaToken };
                }
                throw new Error('No access_token in response');
            }
            
            // Success - we have tokens!
            homey.app.log('✅ Tokens received successfully');
            
            // Stellantis returns both UUID (access_token) and JWT (id_token)
            // Store BOTH for flexibility
            homey.app.log('access_token (UUID):', data.access_token);
            homey.app.log('id_token (JWT) preview:', data.id_token ? data.id_token.substring(0, 50) : 'none');
            
            // Save tokens to store
            const tokens: TokenData = {
                accessToken: data.access_token,       // UUID - for Connected Car API
                refreshToken: data.refresh_token,
                expiresIn: data.expires_in,
                expiresAt: Date.now() + (data.expires_in * 1000),
                brand: authData.brand,
                country: authData.country,
                client_id: authData.client_id,
                client_secret: authData.client_secret,
                oauth_url: authData.oauth_url,
                createdAt: Date.now(),
                lastRefresh: Date.now()
            };
            
            homey.settings.set('stellantis_tokens', tokens);
            homey.app.log('Tokens saved successfully');
            
            // Clear auth data (code can only be used once)
            homey.settings.unset('auth_data');
            
            return {
                success: true,
                expiresAt: tokens.expiresAt
            };
            
        } catch (error) {
            homey.app.error('Error exchanging token:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    },
    
    /**
     * Exchange authorization code with OTP for access token
     * Called from settings page when OTP verification is needed
     */
    async exchangeTokenOTP({ homey, body }: ApiArgs): Promise<ApiResponse> {
        homey.app.log('API: Exchange authorization code with OTP');
        
        try {
            const { otp } = body;
            
            if (!otp || otp.length !== 6) {
                throw new Error('Invalid OTP code');
            }
            
            // Get auth data from store
            const authData = homey.settings.get('auth_data') as AuthData | undefined;
            
            if (!authData || !authData.authCode) {
                throw new Error('No authorization code found in store');
            }
            
            homey.app.log('Making OTP token request to:', authData.oauth_url);
            
            // Create Basic Auth header
            const credentials = Buffer.from(`${authData.client_id}:${authData.client_secret}`).toString('base64');
            
            // Build request body
            const bodyParams: any = {
                grant_type: 'authorization_code',
                code: authData.authCode,
                redirect_uri: authData.redirect_uri,
                otp: otp,
                smsMfaCode: otp
            };
            
            // Add MFA token if present
            if (authData.mfa_token) {
                bodyParams.mfaToken = authData.mfa_token;
                homey.app.log('Using MFA token from previous response');
            }
            
            const response = await fetch(`${authData.oauth_url}/am/oauth2/access_token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${credentials}`
                },
                body: new URLSearchParams(bodyParams)
            });
            
            const responseText = await response.text();
            homey.app.log('OTP token response status:', response.status);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${responseText}`);
            }
            
            const data = JSON.parse(responseText);
            
            if (!data.access_token) {
                throw new Error('No access_token in response');
            }
            
            // Stellantis returns UUID in access_token, but JWT in id_token
            const actualAccessToken = data.id_token || data.access_token;
            const isJWT = actualAccessToken.startsWith('eyJ') || actualAccessToken.startsWith('eyA');
            
            homey.app.log('Using token from:', data.id_token ? 'id_token (JWT)' : 'access_token (UUID)');
            homey.app.log('Token is JWT:', isJWT);
            
            // Save tokens to store
            const tokens: TokenData = {
                accessToken: actualAccessToken,  // Use id_token (JWT) instead of access_token (UUID)
                refreshToken: data.refresh_token,
                expiresIn: data.expires_in,
                expiresAt: Date.now() + (data.expires_in * 1000),
                brand: authData.brand,
                country: authData.country,
                client_id: authData.client_id,
                client_secret: authData.client_secret,
                oauth_url: authData.oauth_url,
                createdAt: Date.now(),
                lastRefresh: Date.now()
            };
            
            homey.settings.set('stellantis_tokens', tokens);
            homey.app.log('Tokens saved successfully');
            
            // Clear auth data
            homey.settings.unset('auth_data');
            
            return {
                success: true,
                expiresAt: tokens.expiresAt
            };
            
        } catch (error) {
            homey.app.error('Error with OTP token exchange:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    },
    
    /**
     * Refresh access token using refresh token
     * Called manually or automatically by app
     */
    async refreshToken({ homey }: ApiArgs): Promise<ApiResponse> {
        homey.app.log('API: Refresh access token');
        
        try {
            const tokens = homey.settings.get('stellantis_tokens') as TokenData | undefined;
            
            if (!tokens || !tokens.refreshToken) {
                throw new Error('No refresh token found');
            }
            
            homey.app.log('Current token expires at:', new Date(tokens.expiresAt).toISOString());
            homey.app.log('Time until expiry:', Math.floor((tokens.expiresAt - Date.now()) / 1000 / 60), 'minutes');
            
            // Create Basic Auth header
            const credentials = Buffer.from(`${tokens.client_id}:${tokens.client_secret}`).toString('base64');
            
            homey.app.log('Sending refresh request...');
            const response = await fetch(`${tokens.oauth_url}/am/oauth2/access_token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${credentials}`
                },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: tokens.refreshToken
                })
            });
            
            const responseText = await response.text();
            homey.app.log('Refresh response status:', response.status);
            
            if (!response.ok) {
                homey.app.error('Refresh failed with status:', response.status);
                homey.app.error('Response body:', responseText);
                throw new Error(`HTTP ${response.status}: ${responseText}`);
            }
            
            const data = JSON.parse(responseText);
            homey.app.log('Refresh response keys:', Object.keys(data));
            
            // Stellantis returns UUID in access_token (use this for API calls!)
            // Store both UUID and JWT for flexibility
            tokens.accessToken = data.access_token;  // UUID for Connected Car API
            tokens.refreshToken = data.refresh_token || tokens.refreshToken;
            tokens.expiresIn = data.expires_in;
            tokens.expiresAt = Date.now() + (data.expires_in * 1000);
            tokens.lastRefresh = Date.now();
            
            homey.settings.set('stellantis_tokens', tokens);
            
            homey.app.log('✅ Token refreshed successfully');
            homey.app.log('New access_token (UUID):', data.access_token);
            homey.app.log('New token expires at:', new Date(tokens.expiresAt).toISOString());
            
            return {
                success: true,
                expiresAt: tokens.expiresAt
            };
            
        } catch (error) {
            homey.app.error('❌ Error refreshing token:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    },
    
    /**
     * Test endpoint to verify token and fetch vehicles
     * Helps debug 401 errors
     */
    async testVehicles({ homey }: ApiArgs): Promise<any> {
        homey.app.log('API: Testing vehicles endpoint');
        
        try {
            const tokens = homey.settings.get('stellantis_tokens') as TokenData | undefined;
            
            if (!tokens) {
                return {
                    success: false,
                    error: 'No tokens found in store'
                };
            }
            
            // Check if token is expired
            const now = Date.now();
            const isExpired = now > tokens.expiresAt;
            
            homey.app.log('Token status:', {
                brand: tokens.brand,
                country: tokens.country,
                expiresAt: new Date(tokens.expiresAt).toISOString(),
                isExpired: isExpired,
                timeLeft: Math.floor((tokens.expiresAt - now) / 1000 / 60) + ' minutes'
            });
            
            if (isExpired) {
                return {
                    success: false,
                    error: 'Token is expired',
                    expiresAt: tokens.expiresAt,
                    now: now
                };
            }
            
            // Build correct realm
            const realm = `clientsB2C${tokens.brand.replace('My', '')}`;
            
            // Try to fetch vehicles
            const vehiclesUrl = `https://api.groupe-psa.com/connectedcar/v4/user/vehicles?client_id=${tokens.client_id}`;
            
            homey.app.log('Fetching vehicles...');
            homey.app.log('URL:', vehiclesUrl);
            homey.app.log('Realm:', realm);
            homey.app.log('Using UUID token:', tokens.accessToken);
            
            const response = await fetch(vehiclesUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${tokens.accessToken}`,  // UUID
                    'Accept': 'application/hal+json',  // Stellantis uses HAL format
                    'x-introspect-realm': realm
                    // NO client_id in header!
                }
            });
            
            homey.app.log('Response status:', response.status);
            homey.app.log('Response headers:', JSON.stringify(response.headers.raw()));
            
            const responseText = await response.text();
            homey.app.log('Response body:', responseText.substring(0, 500));
            
            if (!response.ok) {
                return {
                    success: false,
                    error: `HTTP ${response.status}`,
                    status: response.status,
                    body: responseText,
                    url: vehiclesUrl,
                    realm: realm
                };
            }
            
            const data = JSON.parse(responseText);
            const vehicles = data.embedded?.vehicles || data.vehicles || [];
            
            homey.app.log('Vehicles found:', vehicles.length);
            
            return {
                success: true,
                vehicleCount: vehicles.length,
                vehicles: vehicles.map((v: any) => ({
                    id: v.id,
                    vin: v.vin,
                    brand: v.brand,
                    model: v.model
                }))
            };
            
        } catch (error) {
            homey.app.error('Error testing vehicles:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    
};