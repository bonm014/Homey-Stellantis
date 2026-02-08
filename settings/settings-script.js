// Stellantis Homey Settings - Main Script

let state, authUrl, authCode;
let selectedBrand, selectedCountry, brandData, countryData;

// Initialize on load
function init() {
    updateCountries();
    document.getElementById('brand').addEventListener('change', updateCountries);
}

// Update country dropdown based on selected brand
function updateCountries() {
    const brand = document.getElementById('brand').value;
    const select = document.getElementById('country');
    select.innerHTML = '';
    
    Object.keys(BRAND_CONFIG[brand].configs).sort().forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.text = `${c} (${BRAND_CONFIG[brand].configs[c].locale})`;
        select.add(opt);
    });
}

// Step 1: Generate authorization URL
function generateAuthUrl() {
    selectedBrand = document.getElementById('brand').value;
    selectedCountry = document.getElementById('country').value;
    
    brandData = BRAND_CONFIG[selectedBrand];
    countryData = brandData.configs[selectedCountry];
    
    // Generate random state
    state = 'xxxx-xxxx-4xxx-yxxx-xxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c == 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    
    const redirectUri = `${brandData.scheme}://oauth2redirect/${selectedCountry.toLowerCase()}`;
    
    const params = new URLSearchParams({
        client_id: countryData.client_id,
        response_type: 'code',
        scope: 'openid profile',
        redirect_uri: redirectUri,
        state: state
    });
    
    authUrl = `${brandData.oauth_url}/am/oauth2/authorize?${params}`;
    
    document.getElementById('authUrlDisplay').textContent = authUrl;
    goToStep(2);
}

// Step 2: Open authorization URL in browser
function openAuthUrl() {
    window.open(authUrl, '_blank');
}

// Step 2: Copy authorization URL to clipboard
function copyAuthUrl() {
    const url = document.getElementById('authUrlDisplay').textContent;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => {
            alert('URL copied to clipboard!');
        }).catch(() => {
            // Fallback
            prompt('Copy this URL:', url);
        });
    } else {
        // Fallback for older browsers
        prompt('Copy this URL:', url);
    }
}

// Step 2: Extract code and save to Homey store
function extractAndSaveCode() {
    const redirectUrl = document.getElementById('redirectUrl').value.trim();
    
    if (!redirectUrl.includes('oauth2redirect')) {
        showMessage('tokenStatus', 'Invalid URL. Must contain oauth2redirect', 'error');
        return;
    }
    
    try {
        const url = new URL(redirectUrl);
        authCode = url.searchParams.get('code');
        const urlState = url.searchParams.get('state');
        
        if (!authCode) {
            showMessage('tokenStatus', 'No authorization code found in URL', 'error');
            return;
        }
        
        if (urlState !== state) {
            showMessage('tokenStatus', 'State mismatch - security error. Please start over.', 'error');
            return;
        }
        
        // Save code to Homey store
        saveCodeToStore();
        
    } catch (e) {
        showMessage('tokenStatus', 'Error parsing URL: ' + e.message, 'error');
    }
}

// Save authorization data to Homey settings
function saveCodeToStore() {
    const authData = {
        brand: selectedBrand,
        country: selectedCountry,
        authCode: authCode,
        client_id: countryData.client_id,
        client_secret: countryData.client_secret,
        oauth_url: brandData.oauth_url,
        redirect_uri: `${brandData.scheme}://oauth2redirect/${selectedCountry.toLowerCase()}`,
        state: state,
        timestamp: Date.now()
    };
    
    Homey.set('auth_data', authData, function(err) {
        if (err) {
            showMessage('tokenStatus', 'Error saving: ' + err, 'error');
            return;
        }
        
        console.log('Authorization code saved to store');
        
        // Go to step 3 and request token from backend
        goToStep(3);
        requestTokenFromBackend();
    });
}

// Step 3: Request token exchange from backend
function requestTokenFromBackend() {
    showMessage('tokenStatus', '⏳ Requesting access token from Stellantis...', 'info');
    
    console.log('Calling Homey API: exchangeToken');
    
    // Call backend API to exchange code for token
    Homey.api('POST', '/exchangeToken', null, function(err, result) {
        console.log('API response received');
        console.log('Error:', err);
        console.log('Result:', result);
        
        if (err) {
            console.error('API Error:', err);
            showMessage('tokenStatus', 'Error: ' + (err.message || JSON.stringify(err)), 'error');
            return;
        }
        
        if (result.otp_required) {
            // OTP needed
            showMessage('tokenStatus', '📱 SMS verification required', 'info');
            document.getElementById('otpSection').classList.remove('hidden');
        } else if (result.success) {
            // Success!
            onTokenReceived(result);
        } else {
            showMessage('tokenStatus', 'Error: ' + (result.error || 'Unknown error'), 'error');
        }
    });
}

// Step 3: Submit OTP code
function submitOTP() {
    const otp = document.getElementById('otpCode').value.trim();
    
    if (otp.length !== 6 || !/^\d{6}$/.test(otp)) {
        showMessage('tokenStatus', 'OTP must be 6 digits', 'error');
        return;
    }
    
    showMessage('tokenStatus', '⏳ Verifying OTP...', 'info');
    document.getElementById('otpSection').classList.add('hidden');
    
    // Call backend with OTP
    Homey.api('POST', '/exchangeTokenOTP', { otp: otp }, function(err, result) {
        if (err) {
            showMessage('tokenStatus', 'Error: ' + err.message, 'error');
            document.getElementById('otpSection').classList.remove('hidden');
            return;
        }
        
        if (result.success) {
            onTokenReceived(result);
        } else {
            showMessage('tokenStatus', 'OTP verification failed: ' + (result.error || 'Invalid code'), 'error');
            document.getElementById('otpSection').classList.remove('hidden');
        }
    });
}

// Step 4: Token received successfully
function onTokenReceived(result) {
    showMessage('tokenStatus', '✅ Access token received and saved!', 'success');
    
    // Show account info
    const info = `
        <p><strong>Brand:</strong> ${selectedBrand}</p>
        <p><strong>Country:</strong> ${selectedCountry}</p>
        <p><strong>Token expires:</strong> ${new Date(result.expiresAt).toLocaleString()}</p>
    `;
    document.getElementById('accountInfo').innerHTML = info;
    
    setTimeout(() => {
        goToStep(4);
    }, 1000);
}

// Utility: Show message with styling
function showMessage(elementId, message, type) {
    const el = document.getElementById(elementId);
    el.textContent = message;
    el.className = 'message ' + type;
}

// Utility: Navigate between steps
function goToStep(stepNumber) {
    // Hide all steps
    document.querySelectorAll('.step').forEach(s => {
        s.classList.add('hidden');
        s.classList.remove('active');
    });
    
    // Show target step
    const targetStep = document.getElementById('step' + stepNumber);
    targetStep.classList.remove('hidden');
    targetStep.classList.add('active');
    
    // Mark previous steps as completed
    for (let i = 1; i < stepNumber; i++) {
        document.getElementById('step' + i).classList.add('completed');
    }
}

// Homey ready callback
function onHomeyReady(homeyReady) {
    Homey = homeyReady;
    Homey.ready();
    init();
}b