// api.ts - Homey API Endpoints (TypeScript)
// Handles communication between settings page and app

import fetch from 'node-fetch';
import { AuthData, TokenData, ApiResponse, ApiArgs } from './types';
import { StellantisApiClient,StellantisRemoteClient } from './Lib/Stellantis/src'
import StellantisApp from './app';

module.exports = {
    async validateOTP(args: ApiArgs): Promise<ApiResponse> {
        const { homey, body } = args;
        const { brandName,smsCode, pinCode } = body;

        homey.app.log(`Validate OTP ${smsCode}`);

        const tokens:TokenData = homey.settings.get('stellantis_tokens_' + brandName.toLowerCase());

        let myApp = homey.app as StellantisApp;

        let myClient = await myApp.getStellantisClient(brandName);

        var client:StellantisApiClient = new StellantisApiClient(homey.app, tokens.accessToken, tokens.brand, tokens.country,tokens.client_id);

        var user = await client.getUser();

        var remoteClient:StellantisRemoteClient = new StellantisRemoteClient({
            accessToken: await myClient.getAccessToken(),
            clientId:tokens.client_id,
            clientSecret:tokens.client_secret,
            countryCode: myClient.country,
            customerId: user.email,
            realm:`clientsB2C${brandName.replace('My', '')}`
        });

        await remoteClient.validateOTP(homey,smsCode, pinCode,tokens.brand,tokens.client_id);

        return { success: true, expiresAt:0 };
    },

    /**
     * Exchange authorization code for access token
     * Called from settings page after user provides auth code
     */
    async requestOTP(args: ApiArgs): Promise<ApiResponse> {
        const { homey, body } = args;
        const { brandName } = body;

        homey.app.log(`Requesting OTP ${brandName}`);

        const tokens:TokenData = homey.settings.get('stellantis_tokens_' + brandName.toLowerCase());

        let myApp = homey.app as StellantisApp;

        let myClient = await myApp.getStellantisClient(brandName);

        var client:StellantisApiClient = new StellantisApiClient(homey.app, tokens.accessToken, tokens.brand, tokens.country,tokens.client_id);

        var user = await client.getUser();

        var remoteClient:StellantisRemoteClient = new StellantisRemoteClient({
            accessToken: await myClient.getAccessToken(),
            clientId:tokens.client_id,
            clientSecret:tokens.client_secret,
            countryCode: myClient.country,
            customerId: user.email,
            realm:`clientsB2C${brandName.replace('My', '')}`
        });

        await remoteClient.requestOTP();

        return { success: true, expiresAt:0 };
    },

    /**
     * Exchange authorization code for access token
     * Called from settings page after user provides auth code
     */
    async exchangeToken(args: ApiArgs): Promise<ApiResponse> {
        const { homey, body } = args;

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