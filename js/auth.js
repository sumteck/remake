/**
 * auth.js
 * =======
 * Google OAuth 2.0 authentication.
 * Updated: Google Drive permission included for auto-creating sheets.
 */

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((sw) => sw.unregister());
  });
}

const TbrAuth = (() => {
  const LS_TOKEN  = "tbr_access_token";
  const LS_EXPIRY = "tbr_token_expiry";

  let _tokenClient = null;
  let _accessToken = null;
  let _tokenExpiry = 0;

  const _signInCallbacks  = [];
  const _signOutCallbacks = [];

  function _saveSession() {
    try {
      localStorage.setItem(LS_TOKEN,  _accessToken);
      localStorage.setItem(LS_EXPIRY, String(_tokenExpiry));
    } catch (e) { }
  }

  function _clearSession() {
    try {
      localStorage.removeItem(LS_TOKEN);
      localStorage.removeItem(LS_EXPIRY);
    } catch (e) { }
  }

  function _tryRestoreSession() {
    try {
      const token  = localStorage.getItem(LS_TOKEN);
      const expiry = parseInt(localStorage.getItem(LS_EXPIRY) || "0", 10);
      if (token && expiry > Date.now()) {
        _accessToken = token;
        _tokenExpiry = expiry;
        return true;
      }
      if (token || expiry) _clearSession();
    } catch (e) { }
    return false;
  }

  function _waitForGIS() {
    return new Promise((resolve, reject) => {
      if (typeof google !== "undefined" && google.accounts?.oauth2) return resolve();
      let attempts = 0;
      const id = setInterval(() => {
        attempts++;
        if (typeof google !== "undefined" && google.accounts?.oauth2) {
          clearInterval(id);
          resolve();
        } else if (attempts >= 100) {
          clearInterval(id);
          reject(new Error("Google Identity Services did not load."));
        }
      }, 100);
    });
  }

  async function _ensureTokenClient() {
    if (_tokenClient) return;
    await _waitForGIS();
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: TBR_CONFIG.CLIENT_ID,
      // ഇവിടെയാണ് ഗൂഗിൾ ഡ്രൈവിന്റെ പെർമിഷൻ കൂടി നമ്മൾ ചേർത്തത്
      scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file",
      callback:  (tokenResponse) => {
        if (tokenResponse.error) {
          _showAuthError(tokenResponse.error_description || tokenResponse.error);
          return;
        }
        _accessToken = tokenResponse.access_token;
        _tokenExpiry = Date.now() + (tokenResponse.expires_in - 60) * 1000;
        _saveSession();
        _updateUI(true);
        _signInCallbacks.forEach(cb => { try { cb(_accessToken); } catch(e){} });
      },
    });
  }

  function _showAuthError(msg) {
    const el = document.getElementById("auth-error-msg");
    if (el) { el.textContent = msg; el.classList.remove("hidden"); }
  }

  function _updateUI(isSignedIn) {
    document.querySelectorAll("[data-tbr='signin-btn']").forEach(btn => btn.classList.toggle("hidden",  isSignedIn));
    document.querySelectorAll("[data-tbr='signout-btn']").forEach(btn => btn.classList.toggle("hidden", !isSignedIn));
    document.querySelectorAll("[data-tbr='auth-gated']").forEach(el  => el.classList.toggle("hidden", !isSignedIn));
    const banner = document.getElementById("auth-status-banner");
    if (banner) banner.classList.toggle("hidden", !isSignedIn);
    const errEl = document.getElementById("auth-error-msg");
    if (errEl) errEl.classList.add("hidden");
  }

  _tryRestoreSession();

  return {
    onSignIn(cb) { if (typeof cb === "function") _signInCallbacks.push(cb); },
    onSignOut(cb) { if (typeof cb === "function") _signOutCallbacks.push(cb); },
    init() {
      if (_accessToken && Date.now() < _tokenExpiry) {
        _updateUI(true);
        _signInCallbacks.forEach(cb => { try { cb(_accessToken); } catch(e){} });
      } else {
        _updateUI(false);
      }
    },
    async signIn() {
      try { await _ensureTokenClient(); } catch (err) { return _showAuthError(err.message); }
      if (_accessToken && Date.now() < _tokenExpiry) {
        _updateUI(true);
        _signInCallbacks.forEach(cb => { try { cb(_accessToken); } catch(e){} });
        return;
      }
      _tokenClient.requestAccessToken({ prompt: "" });
    },
    signOut() {
      if (_accessToken) google.accounts.oauth2.revoke(_accessToken, () => {});
      _accessToken = null;
      _tokenExpiry = 0;
      _clearSession();
      _updateUI(false);
      _signOutCallbacks.forEach(cb => { try { cb(); } catch(e){} });
    },
    getToken() { return (_accessToken && Date.now() < _tokenExpiry) ? _accessToken : null; },
    isSignedIn() { return !!this.getToken(); },
    bindButtons() {
      document.querySelectorAll("[data-tbr='signin-btn']").forEach(btn => btn.addEventListener("click", () => TbrAuth.signIn()));
      document.querySelectorAll("[data-tbr='signout-btn']").forEach(btn => btn.addEventListener("click", () => TbrAuth.signOut()));
    },
  };
})();
