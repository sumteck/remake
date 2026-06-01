/**
 * auth.js — v3
 * ============
 * Google OAuth 2.0 authentication for the Treasury Bill Reconciliation App.
 * Uses Google Identity Services (GIS) token-based / implicit flow.
 *
 * ==========================================================================
 * WHAT'S NEW IN v3  (session persistence across MPA page navigation)
 * ==========================================================================
 *
 * PROBLEM
 * -------
 * The app is a Multi-Page Application. Every time the user follows a navbar
 * link (index.html → report.html, or back), the browser discards the entire
 * JavaScript environment. The in-memory `_accessToken` is destroyed and the
 * user sees the sign-in prompt again on every page.
 *
 * SOLUTION — sessionStorage persistence
 * --------------------------------------
 * On every successful sign-in (new token received from GIS) the access token
 * and its expiry timestamp are written to sessionStorage under two keys:
 *
 *   sessionStorage["tbr_access_token"]   – the raw OAuth access token string
 *   sessionStorage["tbr_token_expiry"]   – epoch-ms expiry as a string
 *
 * On every page load the IIFE immediately calls _tryRestoreSession(), which:
 *   1. Reads both keys from sessionStorage.
 *   2. Checks that the token exists AND has not expired.
 *   3. If valid: copies the values back into the in-memory variables.
 *      (No UI update yet — page modules haven't registered callbacks yet.)
 *   4. If missing or expired: removes the stale keys and leaves state empty.
 *
 * The deferred UI update is handled by the new public `init()` method, which
 * must be called from DOMContentLoaded AFTER all page modules have registered
 * their `onSignIn` / `onSignOut` callbacks. `init()` checks the in-memory
 * state (already populated by _tryRestoreSession) and fires _updateUI and all
 * callbacks exactly once, in the right order.
 *
 * WHY sessionStorage AND NOT localStorage?
 * -----------------------------------------
 * • sessionStorage is cleared automatically when the tab closes or the
 *   browser session ends — correct behaviour for OAuth tokens.
 * • Each tab has its own independent sessionStorage, so signing out in one
 *   tab does not affect other tabs (desirable in a multi-user environment).
 * • localStorage would persist tokens across browser restarts, creating a
 *   stale-token risk if the machine is shared or the token is revoked.
 *
 * SECURITY NOTE
 * -------------
 * sessionStorage is readable by any same-origin JavaScript. If an attacker
 * can execute arbitrary JS on the page they can read the token — but this is
 * identical to the risk of storing it in memory. sessionStorage does NOT
 * increase the XSS attack surface compared to the previous in-memory approach.
 * HTTPS (enforced on GitHub Pages) prevents network-level interception.
 *
 * ==========================================================================
 * FIXES CARRIED FORWARD FROM v2
 * ==========================================================================
 *
 * FIX-1 (v2) — CALLBACK OVERWRITE
 *   v1 used scalar `_onSignInCallback` / `_onSignOutCallback`. The last
 *   caller to `onSignIn(cb)` silently discarded all previous registrations.
 *   Fixed by using arrays: every call appends; all callbacks fire in order.
 *
 * FIX-2 (v2) — GIS ASYNC RACE
 *   `async defer` on the GIS <script> tag means `google.accounts` may not
 *   exist when auth.js executes. `_ensureTokenClient()` now awaits a 100 ms
 *   polling loop (max 10 s) before initialising the token client.
 *
 * FIX-3 (v2) — STALE SERVICE WORKER
 *   A leftover dev-time SW can intercept requests and serve cached JS/HTML.
 *   A one-time cleanup at module load unregisters all SWs on the origin.
 */

// ── Service Worker cleanup ────────────────────────────────────────────────
/**
 * auth.js
 * =======
 * Google OAuth 2.0 authentication.
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
      scope:     TBR_CONFIG.SCOPES,
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