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
    async exchangeToken({ homey }: ApiArgs,brand:string): Promise<ApiResponse> {
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
            } else {
                homey.app.error('❌ No access_token in response!');
                homey.app.error('Response keys:', Object.keys(data));
            }
                        
            if (!data.access_token) {
                homey.app.log('No access_token found, might be 2FA flow');
                // Check if this is a 2FA intermediate response
                throw new Error('No access_token in response');
            }
            
            // Success - we have tokens!
            homey.app.log('✅ Tokens received successfully');
                        
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
            
            homey.settings.set('stellantis_tokens_' + tokens.brand.toLowerCase(), tokens);
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
    }
};