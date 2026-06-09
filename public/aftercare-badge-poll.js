/**
 * Aftercare Badge Poll V1.0.1
 * ===========================
 * Lightweight standalone script that polls the unread message count
 * and updates a badge element on the host page.
 *
 * USAGE:
 *   1. Host page includes an element with id="aftercare-text-nav-badge"
 *   2. Set the API key (same value as API_CLIENT_KEYS on the API), either:
 *        - data-api-key="..." on the badge element, or
 *        - window.AFTERCARE_CONFIG = { account_api_key: '...', apiKey: '...' }
 *        (api_key is also accepted on AFTERCARE_CONFIG.)
 *        NOTE: account_api_key is the tukios_api_key stored on the accounts table.
 *   3. Optionally set data-api-base / data-account-api-key (or apiBase / account_api_key on config).
 *   4. Load this script: <script src="aftercare-badge-poll.js" defer></script>
 *   5. The script polls every 2 minutes and sets the badge text content.
 */
(function () {
  'use strict';

  var POLL_INTERVAL = 120000; // 2 minutes
  var DEFAULT_API_BASE = 'https://aftercare-app-api-18edbb932ed8.herokuapp.com/api/';
  var DEFAULT_API_KEY = '';
  // account_api_key refers to the tukios_api_key stored on the accounts table.
  var DEFAULT_ACCOUNT_API_KEY = '1';
  var BADGE_ID = 'aftercare-text-nav-badge';
  // The badge poll calls go through the per-account auth wrapper mounted at
  // /api/widget/* on the API. widgetAuth resolves the bearer key to an
  // account.id and injects it into req.query.account_id so the underlying
  // /text-messages/unread-count handler (which still requires account_id for
  // its other consumers) works transparently.
  var WIDGET_PATH_PREFIX = 'widget';

  // Hosts typically put data-* attributes on the widget root div, not on the
  // (possibly bare) badge element. Read from either, preferring the badge
  // element when both are present.
  function readDataset(key) {
    var badge = document.getElementById(BADGE_ID);
    if (badge && badge.dataset && badge.dataset[key]) return badge.dataset[key];
    var widgetRoot = document.getElementById('aftercare-text-root');
    if (widgetRoot && widgetRoot.dataset && widgetRoot.dataset[key]) return widgetRoot.dataset[key];
    return undefined;
  }

  function getConfig() {
    var globalConfig = typeof window !== 'undefined' && window.AFTERCARE_CONFIG;
    var apiKey =
      readDataset('apiKey') ||
      (globalConfig && (globalConfig.apiKey || globalConfig.api_key)) ||
      DEFAULT_API_KEY;
    return {
      apiBase: readDataset('apiBase') || (globalConfig && globalConfig.apiBase) || DEFAULT_API_BASE,
      // account_api_key refers to the tukios_api_key stored on the accounts table.
      account_api_key: readDataset('accountApiKey') || (globalConfig && globalConfig.account_api_key) || DEFAULT_ACCOUNT_API_KEY,
      apiKey: apiKey,
    };
  }

  function fetchUnreadCount() {
    var badge = document.getElementById(BADGE_ID);
    if (!badge) return;

    var config = getConfig();
    if (!config.apiBase) return;

    var url = config.apiBase.replace(/\/$/, '') +
      '/' + WIDGET_PATH_PREFIX + '/text-messages/unread-count?days_back=100000';

    var headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) {
      headers['X-API-Key'] = config.apiKey;
    }
    // account_api_key is the tukios_api_key stored on the accounts table.
    if (config.account_api_key) {
      headers['Authorization'] = 'Bearer ' + config.account_api_key;
    }

    fetch(url, { method: 'GET', headers: headers })
      .then(function (res) {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then(function (raw) {
        var count = 0;
        if (typeof raw === 'number') {
          count = raw;
        } else if (typeof raw === 'string' && !isNaN(parseInt(raw, 10))) {
          count = parseInt(raw, 10);
        } else if (raw != null && typeof raw === 'object') {
          var inner = raw.data != null ? raw.data : raw;
          count = inner.total_unread != null ? inner.total_unread
            : inner.count != null ? inner.count
            : inner.unreadCount != null ? inner.unreadCount
            : typeof inner === 'number' ? inner
            : 0;
        }

        var el = document.getElementById(BADGE_ID);
        if (el) {
          el.textContent = count > 0 ? String(count) : '';
        }
      })
      .catch(function (err) {
        console.warn('[aftercare-badge-poll] fetch error:', err);
      });
  }

  function init() {
    var badge = document.getElementById(BADGE_ID);
    if (!badge) {
      var observer = new MutationObserver(function () {
        if (document.getElementById(BADGE_ID)) {
          observer.disconnect();
          start();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      return;
    }
    start();
  }

  function start() {
    fetchUnreadCount();
    setInterval(fetchUnreadCount, POLL_INTERVAL);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
