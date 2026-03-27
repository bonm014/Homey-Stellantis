// api.ts - Homey API Endpoints (TypeScript)
// Handles communication between settings page and app

import fetch from 'node-fetch';
import { AuthData, TokenData, ApiResponse, ApiArgs,StellantisClient,StellantisRemoteClient } from './Lib/Stellantis/src';
import StellantisApp from './app';

module.exports = {

    async refreshOTP(args: ApiArgs): Promise<ApiResponse> {
        const { homey, body } = args;
        const { brandName } = body;

        homey.app.log(`Refresh OTP ${brandName}`);

        const tokens:TokenData = homey.settings.get('stellantis_tokens_' + brandName.toLowerCase());

        let myApp = homey.app as StellantisApp;

        homey.app.log(`Get client`);
        let client = await myApp.getStellantisClient(brandName);

        homey.app.log(`get remote client`);
        var remoteClient = await client.getRemoteClient();

        if(remoteClient == null)
        {
            return { success: true, expiresAt:0 };
        }

        console.log('[TOKEN] Before refresh:', this.config.accessToken.substring(0, 20));
        await this.refreshToken(); // of hoe je het ook doet
        console.log('[TOKEN] After refresh:', this.config.accessToken.substring(0, 20));

        homey.app.log(`validate`);
        await remoteClient.validateOTP(homey,null, null,tokens.brand,tokens.client_id,false);

        return { success: true, expiresAt:0 };
    },

    async validateOTP(args: ApiArgs): Promise<ApiResponse> {
        const { homey, body } = args;
        const { brandName,smsCode, pinCode } = body;

        homey.app.log(`Validate OTP ${smsCode}`);
        homey.app.log(`Validate OTP ${brandName}`);
        homey.app.log(`Validate OTP ${pinCode}`);
        

        let myApp = homey.app as StellantisApp;
        let client = await myApp.getStellantisClient(brandName);
        //await client.refreshTokens();

        const tokens:TokenData = homey.settings.get('stellantis_tokens_' + brandName.toLowerCase());

        homey.app.log(`Get client`);

        homey.app.log(`get remote client`);
        var remoteClient = await client.getRemoteClient();
        if(remoteClient == null)
        {
            return { success: true, expiresAt:0 };
        }

        await remoteClient.validateOTP(homey,smsCode, pinCode,tokens.brand,tokens.client_id,true);

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

        let client = await myApp.getStellantisClient(brandName);

        var remoteClient = await client.getRemoteClient()
        if(remoteClient == null)
        {
            return { success: true, expiresAt:0 };
        }

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
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${responseText}`);
            }
            
            const data = JSON.parse(responseText);
            
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
            
            //Clear old token
            let app = homey.app as StellantisApp;
            let client = app.getStellantisClient(tokens.brand);
            
            //Make sure the old token are removed
            client.clearConfig();

            //Update the config with the new tokens
            client.updateConfig(tokens);

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