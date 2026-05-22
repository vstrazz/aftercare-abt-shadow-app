/**
 * Aftercare Text Widget V1.1.4
 * =====================
 * Self-contained script that renders the Aftercare Text inbox
 * inside a Shadow DOM root on any host page.
 *
 * USAGE:
 *   1. Host page includes a div with id="aftercare-text-root" data-account-api-key="..."
 *      (account_api_key is the tukios_api_key stored on the accounts table)
 *   2. Or set window.AFTERCARE_CONFIG = { account_api_key: '...' } before loading the script
 *   3. Host page loads this script: <script src="aftercare-text-widget.js" defer></script>
 *   4. The script attaches a Shadow DOM to the host div and renders the
 *      full inbox UI (conversation list, thread view, schedule panel)
 *      with styles fully encapsulated from the host page.
 *
 * OPTIONAL:
 *   - If the host page has an element with id="aftercare-text-nav-badge",
 *     the script will update it with the current attention count.
 *   - Set data-api-key on #aftercare-text-root (or window.AFTERCARE_CONFIG.apiKey)
 *     to match API_CLIENT_KEYS on the API when key enforcement is enabled.
 */
(function () {
  'use strict';

  const DEFAULT_API_BASE = 'https://aftercare-app-api-staging-be5961c463a6.herokuapp.com/api';
  // Global API client key (matches API_CLIENT_KEYS on the API). Sent as
  // X-API-Key on every request to satisfy the global requireApiKey gate.
  // Hosts can override via data-api-key or AFTERCARE_CONFIG.apiKey.
  const DEFAULT_API_KEY = 'iYqk0m7sfswRkGoLSMoYNC054ZDYg80g';
  // account_api_key refers to the tukios_api_key stored on the accounts table.
  const DEFAULT_ACCOUNT_API_KEY = '1';
  // All widget calls go through the per-account auth wrapper mounted at
  // /api/widget/* on the API. The underlying handlers (text-messages,
  // aftercare-families) are re-mounted there with widgetAuth, which
  // resolves the bearer key to an account.id and injects it into the
  // request before the public handlers run. The original public routes
  // (e.g. /api/text-messages/*) remain unchanged for other consumers.
  const WIDGET_PATH_PREFIX = 'widget';

  var _activeStream = null;
  var _activeStreamRecipientId = null;

  function connectStream(root, recipientId) {
    disconnectStream();

    var config = getConfig(root);
    if (!config.apiBase) return;

    var streamBase = config.apiBase.replace(/\/$/, '') + '/' + WIDGET_PATH_PREFIX + '/text-messages/stream/' + encodeURIComponent(recipientId);
    var streamUrl = new URL(streamBase);
    // EventSource does not support custom request headers, so for the SSE stream we have to
    // pass account_api_key as a query parameter instead of an Authorization: Bearer header.
    // account_api_key is the tukios_api_key stored on the accounts table.
    streamUrl.searchParams.set('account_api_key', String(config.account_api_key));
    if (config.apiKey) streamUrl.searchParams.set('api_key', config.apiKey);
    var es;
    try {
      es = new EventSource(streamUrl.toString());
    } catch (e) {
      return;
    }

    _activeStream = es;
    _activeStreamRecipientId = recipientId;

    es.addEventListener('message_received', function (evt) {
      if (_activeStreamRecipientId !== recipientId) return;

      var msg;
      try { msg = JSON.parse(evt.data); } catch (e) { return; }

      appendStreamMessage(root, msg, recipientId);
    });

    es.addEventListener('error', function () {
      if (es.readyState === EventSource.CLOSED) {
        // Server closed the connection; try to reconnect after a delay
        setTimeout(function () {
          if (_activeStreamRecipientId === recipientId) {
            connectStream(root, recipientId);
          }
        }, 5000);
      }
    });
  }

  function disconnectStream() {
    if (_activeStream) {
      _activeStream.close();
      _activeStream = null;
    }
    _activeStreamRecipientId = null;
  }

  function appendStreamMessage(root, msg, recipientId) {
    var msgsEl = root.querySelector('.ac-msgs');
    if (!msgsEl) return;

    var msgType = msg.message_type || msg.messageType || '';

    if (msgType === 'admin-note' || msgType === 'admin_note') {
      var flag = document.createElement('div');
      flag.className = 'ac-flag';
      flag.textContent = '\u2726 ' + (msg.text_message || msg.textMessage || '');
      msgsEl.appendChild(flag);
      msgsEl.scrollTop = msgsEl.scrollHeight;
      return;
    }

    var dir = (msgType === 'outgoing' || msgType === 'outgoing_campaign') ? 'out' : 'in';
    var body = msg.text_message != null ? msg.text_message : (msg.textMessage != null ? msg.textMessage : (msg.body != null ? msg.body : ''));
    var rawDate = msg.entry_date || msg.entryDate || msg.createdAt || '';
    var meta = '';
    if (rawDate) {
      var d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        meta = d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      }
    }

    var hasMod = msg.moderation && msg.moderation.length > 0;
    var flagged = (msgType === 'incoming' && !msg.moderated && !msg.admin_viewed && hasMod) ? ' flagged' : '';

    var imgHtml = '';
    if (msg.image) {
      imgHtml = '<div style="margin-top:8px;"><img src="' + escapeAttr(msg.image) + '" style="max-width:200px;border-radius:8px;" /></div>';
    }

    var bubble = document.createElement('div');
    bubble.className = 'ac-bubble ' + dir + flagged;
    bubble.innerHTML = escapeHtml(body) + imgHtml + '<div class="ac-meta">' + escapeHtml(meta) + '</div>';
    msgsEl.appendChild(bubble);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    updateConversationPreview(root, recipientId, body, rawDate);
  }

  function updateConversationPreview(root, recipientId, text, rawDate) {
    var item = root.querySelector('.ac-msg[data-recipient-id="' + recipientId + '"]')
      || root.querySelector('.ac-msg[data-id="' + recipientId + '"]');
    if (!item) return;

    var preview = item.querySelector('.ac-msg-preview');
    if (preview && text) {
      preview.textContent = text.length > 80 ? text.substring(0, 80) + '…' : text;
    }
    var dateEl = item.querySelector('.ac-msg-date');
    if (dateEl && rawDate) {
      dateEl.textContent = formatDate(rawDate);
    }
  }

  function getConfig(root) {
    var hostEl = (root && root._hostEl) || root;
    const globalConfig = typeof window !== 'undefined' && window.AFTERCARE_CONFIG;
    return {
      apiBase: (hostEl && hostEl.dataset && hostEl.dataset.apiBase) || (globalConfig && globalConfig.apiBase) || DEFAULT_API_BASE,
      // account_api_key refers to the tukios_api_key stored on the accounts table.
      account_api_key: (hostEl && hostEl.dataset && hostEl.dataset.accountApiKey) || (globalConfig && globalConfig.account_api_key) || DEFAULT_ACCOUNT_API_KEY,
      apiKey: (hostEl && hostEl.dataset && hostEl.dataset.apiKey) || (globalConfig && (globalConfig.apiKey || globalConfig.api_key)) || DEFAULT_API_KEY,
    };
  }

  function jsonHeaders(config) {
    var h = { 'Content-Type': 'application/json' };
    if (config && config.apiKey) h['X-API-Key'] = config.apiKey;
    // account_api_key is the tukios_api_key stored on the accounts table.
    if (config && config.account_api_key) h['Authorization'] = 'Bearer ' + config.account_api_key;
    return h;
  }

  function apiGet(config, path, params) {
    if (!config || !config.apiBase) return Promise.reject(new Error('API base URL not configured'));
    var base = config.apiBase.replace(/\/$/, '');
    var search = new URLSearchParams(params || {});
    var pathPart = path.replace(/^\//, '');
    var url = pathPart.indexOf('?') !== -1
      ? base + '/' + pathPart + '&' + search.toString()
      : base + '/' + pathPart + (search.toString() ? '?' + search.toString() : '');
    return fetch(url, { method: 'GET', headers: jsonHeaders(config) })
      .then(function (res) {
        if (!res.ok) throw new Error(res.statusText || 'Request failed');
        const ct = res.headers.get('content-type');
        return ct && ct.indexOf('application/json') !== -1 ? res.json() : res.text();
      });
  }

  function apiDelete(config, path, params) {
    if (!config || !config.apiBase) return Promise.reject(new Error('API base URL not configured'));
    var base = config.apiBase.replace(/\/$/, '');
    var pathPart = path.replace(/^\//, '');
    var search = new URLSearchParams(params || {});
    var qs = search.toString();
    var url = base + '/' + pathPart + (qs ? '?' + qs : '');
    return fetch(url, { method: 'DELETE', headers: jsonHeaders(config) })
      .then(function (res) {
        if (!res.ok) throw new Error(res.statusText || 'Request failed');
        var ct = res.headers.get('content-type');
        return ct && ct.indexOf('application/json') !== -1 ? res.json() : res.text();
      });
  }

  function apiPost(config, path, body) {
    if (!config || !config.apiBase) return Promise.reject(new Error('API base URL not configured'));
    var base = config.apiBase.replace(/\/$/, '');
    var pathPart = path.replace(/^\//, '');
    var url = base + '/' + pathPart;
    return fetch(url, {
      method: 'POST',
      headers: jsonHeaders(config),
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      if (!res.ok) throw new Error(res.statusText || 'Request failed');
      var ct = res.headers.get('content-type');
      return ct && ct.indexOf('application/json') !== -1 ? res.json() : res.text();
    });
  }

  function apiPostFormData(config, path, formData) {
    if (!config || !config.apiBase) return Promise.reject(new Error('API base URL not configured'));
    var base = config.apiBase.replace(/\/$/, '');
    var pathPart = path.replace(/^\//, '');
    var url = base + '/' + pathPart;
    // Omit Content-Type so the browser sets multipart/form-data with the correct boundary.
    var headers = {};
    if (config.apiKey) headers['X-API-Key'] = config.apiKey;
    if (config.account_api_key) headers['Authorization'] = 'Bearer ' + config.account_api_key;
    return fetch(url, {
      method: 'POST',
      headers: headers,
      body: formData,
    }).then(function (res) {
      if (!res.ok) throw new Error(res.statusText || 'Request failed');
      var ct = res.headers.get('content-type');
      return ct && ct.indexOf('application/json') !== -1 ? res.json() : res.text();
    });
  }

  // Wait for DOM
  function init() {
    const root = document.getElementById('aftercare-text-root');
    if (!root) return; // Container not present yet

    // Observe for container appearing (SPA navigation)
    if (!root.offsetParent && !root.offsetWidth) {
      const observer = new MutationObserver(function () {
        if (root.offsetParent || root.offsetWidth) {
          observer.disconnect();
          render(root);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      render(root);
      return;
    }
    render(root);
  }

  function render(hostEl) {
    if (hostEl.dataset.aftercareInit) return;
    hostEl.dataset.aftercareInit = 'true';
    disconnectStream();

    var shadow = hostEl.attachShadow({ mode: 'open' });

    var fontHref = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap';

    if (!document.querySelector('link[href*="DM+Sans"]')) {
      var docFont = document.createElement('link');
      docFont.rel = 'stylesheet';
      docFont.href = fontHref;
      document.head.appendChild(docFont);
    }

    var fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = fontHref;
    shadow.appendChild(fontLink);

    var styleEl = document.createElement('style');
    styleEl.textContent = getStyles();
    shadow.appendChild(styleEl);

    var root = document.createElement('div');
    root.className = 'ac-root';
    root.innerHTML = getHTML();
    root._hostEl = hostEl;
    shadow.appendChild(root);

    bindProductGate(root, function () {
      var textUi = root.querySelector('#ac-text-ui');
      if (textUi) {
        textUi.style.display = 'flex';
      }
      bindEvents(root);
      loadConversationList(root);
    });
  }

  /**
   * POST /api/tukios-auth/product returns { success, product: 'ACP' | 'ABT' | 'Dual' }.
   * Older servers may return { success, products: ['ACP', 'ABT'] } instead.
   */
  function isAcpCardsOnlyProductResponse(data) {
    if (!data || !data.success) return false;
    var p = data.product;
    if (typeof p === 'string' && p.trim().toUpperCase() === 'ACP') {
      return true;
    }
    var list = data.products;
    if (!Array.isArray(list) || list.length === 0) return false;
    var norm = list.map(function (x) {
      return String(x || '').trim().toUpperCase();
    });
    return norm.indexOf('ABT') === -1 && norm.indexOf('ACP') !== -1;
  }

  /**
   * Same POST /api/tukios-auth + redirect as top-bar / ACP-only buttons.
   */
  function wireAftercareAdminButton(root, selector, defaultLabel) {
    var btn = root.querySelector(selector);
    if (!btn) return;
    btn.addEventListener('click', function () {
      var config = getConfig(root);
      if (!config.apiBase || !config.account_api_key) {
        btn.textContent = 'Configure API + account key';
        setTimeout(function () {
          btn.textContent = defaultLabel;
        }, 2500);
        return;
      }

      var label = defaultLabel;
      btn.disabled = true;
      btn.textContent = 'Signing in…';

      apiPost(config, 'tukios-auth', {
        tukios_api_key: String(config.account_api_key),
      })
        .then(function (data) {
          var url = data && data.loginUrl;
          if (url && typeof url === 'string') {
            window.location.assign(url);
            return;
          }
          btn.disabled = false;
          btn.textContent = 'Sign-in unavailable';
          setTimeout(function () {
            btn.textContent = label;
          }, 2500);
        })
        .catch(function () {
          btn.disabled = false;
          btn.textContent = 'Sign-in failed — try again';
          setTimeout(function () {
            btn.textContent = label;
          }, 2500);
        });
    });
  }

  function bindProductGate(root, onFullUi) {
    var gate = root.querySelector('#ac-product-gate');
    var loading = root.querySelector('#ac-gate-loading');
    var acpOnly = root.querySelector('#ac-gate-acp-only');
    var textUi = root.querySelector('#ac-text-ui');
    var config = getConfig(root);

    if (!config.apiBase || !config.account_api_key) {
      if (gate) gate.style.display = 'none';
      if (textUi) textUi.style.display = 'flex';
      onFullUi();
      return;
    }

    apiPost(config, 'tukios-auth/product', {
      tukios_api_key: String(config.account_api_key),
    })
      .then(function (data) {
        if (loading) loading.style.display = 'none';
        if (isAcpCardsOnlyProductResponse(data)) {
          if (acpOnly) acpOnly.style.display = 'block';
          wireAftercareAdminButton(root, '#ac-gate-login-btn', 'Open Aftercare.com');
          return;
        }
        if (gate) gate.style.display = 'none';
        if (textUi) textUi.style.display = 'flex';
        onFullUi();
      })
      .catch(function () {
        if (loading) loading.style.display = 'none';
        if (gate) gate.style.display = 'none';
        if (textUi) textUi.style.display = 'flex';
        onFullUi();
      });
  }

  /** Clear thread header and show an idle state when no conversation is selected (e.g. empty list). */
  function resetConvoPanelForNoSelection(root) {
    var hdr = root.querySelector('.ac-convo-hdr');
    if (hdr) {
      var nameEl = hdr.querySelector('.ac-convo-name');
      var phoneEl = hdr.querySelector('.ac-convo-phone');
      var decEl = hdr.querySelector('.ac-convo-dec');
      var ddateEl = hdr.querySelector('.ac-convo-ddate');
      var sep = hdr.querySelector('.ac-convo-sep');
      if (nameEl) nameEl.textContent = '';
      if (phoneEl) phoneEl.textContent = '';
      if (decEl) decEl.textContent = '';
      if (ddateEl) ddateEl.textContent = '';
      if (sep) sep.style.display = 'none';
      if (decEl) decEl.parentElement.style.display = 'none';
    }
    var msgsEl = root.querySelector('.ac-msgs');
    if (msgsEl) {
      msgsEl.innerHTML = '<div class="ac-sys">No conversation to display.</div>';
    }
  }

  function loadConversationList(root) {
    var config = getConfig(root);
    var listEl = root.querySelector('.ac-list-msgs');
    if (!listEl) return;

    listEl.innerHTML = '<div class="ac-list-loading" style="padding:24px;text-align:center;color:#8b8fa3;font-size:14px;">Loading conversations…</div>';

    // account_api_key (the tukios_api_key stored on the accounts table) is sent via the
    // Authorization: Bearer <account_api_key> header by jsonHeaders(config), not as a query param.
    var params = { limit: 50, offset: 0, days_back: 100000 };
    var count_params = { days_back: 100000 };

    Promise.all([
      apiGet(config, WIDGET_PATH_PREFIX + '/text-messages/conversations', params).catch(function () { return { conversations: [] }; }),
      apiGet(config, WIDGET_PATH_PREFIX + '/text-messages/unread-count', count_params).catch(function () { return { count: 0 }; }),
    ]).then(function (results) {
      var raw = results[0];
      var conversations = (raw.data != null) ? raw.data : ((raw.conversations != null) ? raw.conversations : (Array.isArray(raw) ? raw : []));
      var rawCount = results[1];
      var unreadCount = 0;
      if (typeof rawCount === 'number') {
        unreadCount = rawCount;
      } else if (typeof rawCount === 'string' && !isNaN(parseInt(rawCount, 10))) {
        unreadCount = parseInt(rawCount, 10);
      } else if (rawCount != null && typeof rawCount === 'object') {
        var inner = rawCount.data != null ? rawCount.data : rawCount;
        unreadCount = inner.total_unread != null ? inner.total_unread
          : inner.count != null ? inner.count
          : inner.unreadCount != null ? inner.unreadCount
          : typeof inner === 'number' ? inner
          : 0;
      }
      renderConversationList(root, listEl, conversations, unreadCount);
      updateNavBadge(unreadCount);
      bindListEvents(root);
      var firstActive = root.querySelector('.ac-msg.active');
      if (firstActive) {
        var rid = firstActive.dataset.recipientId || firstActive.dataset.id;
        if (rid) loadThread(root, rid);
      } else {
        resetConvoPanelForNoSelection(root);
      }
    }).catch(function () {
      listEl.innerHTML = '<div class="ac-list-loading" style="padding:24px;text-align:center;color:#8b8fa3;font-size:14px;">Unable to load conversations. Check data-api-base and network.</div>';
      resetConvoPanelForNoSelection(root);
    });
  }

  function renderConversationList(root, listEl, conversations, unreadCount) {
    var needsAttention = conversations.filter(function (c) {
      var n = c.unreadCount != null ? c.unreadCount : (c.unread_count != null ? c.unread_count : 0);
      return n > 0;
    });
    var html = '';
    var isFirst = true;

    if (needsAttention.length > 0) {
      html += '<div class="ac-group-hdr">Needs Attention <span class="ac-group-count">' + (unreadCount > 0 ? unreadCount : needsAttention.length) + '</span></div>';
      needsAttention.forEach(function (c) {
        html += conversationItemHtml(c, true, isFirst);
        isFirst = false;
      });
      html += '<div class="ac-divider"></div>';
    }

    conversations.forEach(function (c) {
      if (needsAttention.indexOf(c) !== -1) return;
      html += conversationItemHtml(c, false, isFirst);
      isFirst = false;
    });

    if (!html) {
      html = '<div style="padding:24px;text-align:center;color:#8b8fa3;font-size:14px;">No conversations yet.</div>';
    }

    listEl.innerHTML = html;
  }

  function conversationItemHtml(c, needsAttention, isFirst) {
    var id = c.recipient_id != null ? String(c.recipient_id) : (c.recipientId != null ? String(c.recipientId) : (c.id != null ? String(c.id) : ''));
    var name = (c.recipient_first_name != null || c.recipient_last_name != null)
      ? ((c.recipient_first_name || '') + ' ' + (c.recipient_last_name || '')).trim() || 'Unknown'
      : ((c.recipient && (c.recipient.name || c.recipient.displayName)) || 'Unknown');
    var last = c.last_message || c.lastMessage || {};
    var preview = (last.text_message != null ? last.text_message : (last.body != null ? last.body : (last.preview != null ? last.preview : (last.text != null ? last.text : ''))));
    var rawAt = last.entry_date != null ? last.entry_date : (c.last_message_date != null ? c.last_message_date : (last.createdAt != null ? last.createdAt : (last.sentAt != null ? last.sentAt : (last.at != null ? last.at : last.date))));
    var dateStr = formatDate(rawAt);
    var activeClass = isFirst ? ' active' : '';
    var sparkle = needsAttention ? '<div class="ac-msg-ind"><span class="ac-sparkle">✦</span></div>' : '<div class="ac-msg-ind"></div>';
    var dismiss = needsAttention ? '<div class="ac-dismiss" data-resolve="' + escapeAttr(id) + '">Mark resolved</div>' : '';
    return '<div class="ac-msg' + activeClass + '" data-id="' + escapeAttr(id) + '" data-recipient-id="' + escapeAttr(id) + '">' +
      sparkle +
      '<div class="ac-msg-body">' +
      '<div class="ac-msg-top"><span class="ac-msg-name">' + escapeHtml(name) + '</span><span class="ac-msg-date">' + escapeHtml(dateStr) + '</span></div>' +
      '<div class="ac-msg-preview">' + escapeHtml(preview || '') + '</div>' +
      dismiss + '</div></div>';
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }
  function escapeAttr(s) {
    if (s == null) return '';
    return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function formatDate(raw) {
    if (!raw) return '';
    var d = typeof raw === 'string' ? new Date(raw) : raw;
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var then = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var diff = (today - then) / 86400000;
    if (diff === 0) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function bindListEvents(root) {
    root.querySelectorAll('.ac-msg').forEach(function (el) {
      el.addEventListener('click', function () {
        root.querySelectorAll('.ac-msg').forEach(function (m) { m.classList.remove('active'); });
        el.classList.add('active');
        var recipientId = el.dataset.recipientId || el.dataset.id;
        if (recipientId) loadThread(root, recipientId);
      });
    });
    root.querySelectorAll('.ac-dismiss').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = link.dataset.resolve;
        if (!id) return;
        markReadByRecipient(root, id, link);
      });
    });
  }

  function markReadByRecipient(root, recipientId, dismissLink) {
    var config = getConfig(root);
    if (!config.apiBase) {
      removeMessageRow(root, dismissLink);
      return;
    }
    var recipientIdNum = parseInt(recipientId, 10);
    if (isNaN(recipientIdNum)) {
      removeMessageRow(root, dismissLink);
      return;
    }
    fetch((config.apiBase.replace(/\/$/, '')) + '/' + WIDGET_PATH_PREFIX + '/text-messages/mark-read', {
      method: 'PATCH',
      headers: jsonHeaders(config),
      body: JSON.stringify({ recipient_id: recipientIdNum }),
    }).then(function (res) {
      if (res.ok) removeMessageRow(root, dismissLink);
    }).catch(function () {
      removeMessageRow(root, dismissLink);
    });
  }
  function removeMessageRow(root, dismissLink) {
    var msg = dismissLink && dismissLink.closest('.ac-msg');
    if (!msg) return;

    msg.style.transition = 'opacity 0.3s';
    msg.style.opacity = '0';
    setTimeout(function () {
      msg.remove();
      updateAttentionCount(root);
    }, 300);
  }

  function updateAttentionCount(root) {
    var remaining = root.querySelectorAll('.ac-dismiss').length;
    var countEl = root.querySelector('.ac-group-count');
    var hdrEl = root.querySelector('.ac-group-hdr');
    var divider = root.querySelector('.ac-divider');

    if (remaining > 0) {
      if (countEl) countEl.textContent = remaining;
    } else {
      if (hdrEl) hdrEl.remove();
      if (divider) divider.remove();
    }

    updateNavBadge(remaining);
  }

  function loadThread(root, recipientId) {
    var config = getConfig(root);
    if (!config.apiBase) return;

    var msgsEl = root.querySelector('.ac-msgs');
    if (msgsEl) {
      msgsEl.innerHTML = '<div class="ac-sys">Loading messages…</div>';
    }

    apiGet(config, WIDGET_PATH_PREFIX + '/text-messages/thread/' + encodeURIComponent(recipientId), { order: 'asc' })
      .then(function (data) {
        renderThread(root, data, recipientId);
        connectStream(root, recipientId);
      })
      .catch(function () {
        if (msgsEl) {
          msgsEl.innerHTML = '<div class="ac-sys">Unable to load messages.</div>';
        }
      });
  }

  function renderThread(root, data, recipientId) {
    var inner = data.data || data;
    var messages = inner.messages || [];
    var recipient = inner.recipient || {};
    var family = recipient.family || {};

    var firstName = recipient.first_name || recipient.firstName || '';
    var lastName = recipient.last_name || recipient.lastName || '';
    var name = ((firstName + ' ' + lastName).trim()) || 'Unknown';
    var phone = recipient.phone_number || recipient.phoneNumber || recipient.phone || '';

    var decedentName = family.decedent_name || family.decedentName || '';
    var dateOd = family.date_od || family.dateOd || '';
    var dateOdStr = '';
    if (dateOd) {
      var dd = new Date(dateOd);
      if (!isNaN(dd.getTime())) {
        dateOdStr = 'd. ' + (dd.getMonth() + 1) + '/' + dd.getDate() + '/' + dd.getFullYear();
      }
    }

    var hdr = root.querySelector('.ac-convo-hdr');
    if (hdr) {
      var nameEl = hdr.querySelector('.ac-convo-name');
      var phoneEl = hdr.querySelector('.ac-convo-phone');
      var decEl = hdr.querySelector('.ac-convo-dec');
      var ddateEl = hdr.querySelector('.ac-convo-ddate');
      if (nameEl) nameEl.textContent = name;
      if (phoneEl) phoneEl.textContent = phone;
      if (decEl) decEl.textContent = decedentName || '';
      if (ddateEl) ddateEl.textContent = dateOdStr;

      var sep = hdr.querySelector('.ac-convo-sep');
      if (sep) sep.style.display = decedentName ? '' : 'none';
      if (decEl) decEl.parentElement.style.display = decedentName ? '' : 'none';
    }

    var msgsEl = root.querySelector('.ac-msgs');
    if (!msgsEl) return;
    var html = '';
    messages.forEach(function (msg) {
      var msgType = msg.message_type || msg.messageType || '';
      if (msgType === 'admin-note' || msgType === 'admin_note') {
        html += '<div class="ac-flag">✦ ' + escapeHtml(msg.text_message || msg.textMessage || '') + '</div>';
        return;
      }
      var dir = (msgType === 'outgoing' || msgType === 'outgoing_campaign') ? 'out' : 'in';
      var body = msg.text_message != null ? msg.text_message : (msg.textMessage != null ? msg.textMessage : (msg.body != null ? msg.body : ''));
      var rawDate = msg.entry_date || msg.entryDate || msg.createdAt || '';
      var meta = '';
      if (rawDate) {
        var d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          meta = d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        }
      }

      var hasMod = msg.moderation && msg.moderation.length > 0;
      var flagged = (msgType === 'incoming' && !msg.moderated && !msg.admin_viewed && hasMod) ? ' flagged' : '';

      var imgHtml = '';
      if (msg.image) {
        imgHtml = '<div style="margin-top:8px;"><img src="' + escapeAttr(msg.image) + '" style="max-width:200px;border-radius:8px;" /></div>';
      }

      html += '<div class="ac-bubble ' + dir + flagged + '">' + escapeHtml(body) + imgHtml + '<div class="ac-meta">' + escapeHtml(meta) + '</div></div>';
    });
    msgsEl.innerHTML = html || '<div class="ac-sys">No messages in this thread.</div>';
    msgsEl.scrollTop = msgsEl.scrollHeight;

    var replyBar = root.querySelector('#ac-reply-bar');
    if (replyBar && !replyBar.classList.contains('suppressed')) {
      var input = replyBar.querySelector('input');
      if (input) {
        input.placeholder = 'Type a message…';
        input.dataset.recipientId = recipientId;
      }
    }

    var familyId = family.id || recipient.family_id || recipient.familyId;
    if (familyId) {
      loadSchedule(root, familyId, recipientId);
    }
  }

  function loadSchedule(root, familyId, recipientId) {
    var config = getConfig(root);
    if (!config.apiBase) return;

    var listEl = root.querySelector('#ac-schedule-list');
    if (listEl) {
      listEl.innerHTML = '<div style="font-size:12px;color:#8b8fa3;padding:8px 0;">Loading schedule…</div>';
    }

    apiGet(config, WIDGET_PATH_PREFIX + '/aftercare-families/' + encodeURIComponent(familyId) + '/schedule', { type: 'text' })
      .then(function (res) {
        var items = res.data || res || [];
        if (recipientId) {
          items = items.filter(function (item) {
            var rid = item.recipient_id != null ? String(item.recipient_id) : (item.recipientId != null ? String(item.recipientId) : '');
            return rid === String(recipientId);
          });
        }
        renderSchedule(root, items);
      })
      .catch(function () {
        if (listEl) {
          listEl.innerHTML = '<div style="font-size:12px;color:#8b8fa3;padding:8px 0;">Unable to load schedule.</div>';
        }
      });
  }

  function renderSchedule(root, items) {
    var listEl = root.querySelector('#ac-schedule-list');
    if (!listEl) return;

    if (!items || items.length === 0) {
      listEl.innerHTML = '<div style="font-size:12px;color:#8b8fa3;padding:8px 0;">No scheduled messages.</div>';
      return;
    }

    items.sort(function (a, b) {
      return new Date(a.send_date || a.sendDate) - new Date(b.send_date || b.sendDate);
    });

    root._scheduleItems = {};

    var html = '';
    items.forEach(function (item) {
      var itemId = String(item.id || '');
      root._scheduleItems[itemId] = item;

      var label = item.description || item.desc || '';
      var rawDate = item.send_date || item.sendDate || '';
      var dateStr = '';
      if (rawDate) {
        var d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' });
        }
      }
      var isSent = !!item.sent;
      var icon = isSent
        ? '<span class="ac-sched-check">✓</span>'
        : '<span class="ac-sched-pend"></span>';
      var cls = isSent ? ' sent' : '';

      html += '<div class="ac-sched' + cls + '" data-id="' + escapeAttr(itemId) + '">' +
        icon +
        '<span class="ac-sched-name">' + escapeHtml(label) + '</span>' +
        '<span class="ac-sched-date">' + escapeHtml(dateStr) + '</span>' +
        '</div>';
    });

    listEl.innerHTML = html;
    bindScheduleClicks(root);
  }

  function bindScheduleClicks(root) {
    root.querySelectorAll('#ac-schedule-list .ac-sched').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.dataset.id;
        var item = root._scheduleItems && root._scheduleItems[id];
        if (!item) return;

        var isSent = !!item.sent;
        var label = item.description || item.desc || '';
        var rawDate = item.send_date || item.sendDate || '';
        var dateStr = '';
        if (rawDate) {
          var d = new Date(rawDate);
          if (!isNaN(d.getTime())) {
            dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
          }
        }
        var timing = isSent ? 'Sent ' + dateStr : 'Scheduled for ' + dateStr;
        var message = item.message || item.text_message || item.textMessage || item.body || '';

        root.querySelector('#ac-modal-title').textContent = label;
        root.querySelector('#ac-modal-timing').textContent = timing;
        root.querySelector('#ac-modal-msg').textContent = message;

        var delBtn = root.querySelector('#ac-modal-del');
        delBtn.style.display = isSent ? 'none' : 'inline-block';
        delBtn.dataset.scheduleId = id;

        root.querySelector('#ac-msg-modal').classList.add('visible');
      });
    });
  }

  function clearStagedImage(root) {
    var chip = root.querySelector('#ac-img-chip');
    var thumb = root.querySelector('#ac-img-thumb');
    var label = root.querySelector('#ac-img-chip-label');
    var fileInput = root.querySelector('#ac-img-file');
    if (chip) chip.style.display = 'none';
    if (thumb) { thumb.src = ''; thumb.dataset.s3Url = ''; }
    if (label) label.textContent = '';
    if (fileInput) fileInput.value = '';
  }

  function sendMessage(root) {
    var config = getConfig(root);
    if (!config.apiBase) return;

    var input = root.querySelector('#ac-reply-bar .message-input');
    if (!input) return;

    var message = input.value.trim();
    var thumb = root.querySelector('#ac-img-thumb');
    var imageUrl = (thumb && thumb.dataset.s3Url) || '';

    if (!message && !imageUrl) return;

    var recipientId = input.dataset.recipientId;
    if (!recipientId) return;

    var sendBtn = root.querySelector('.ac-send-btn');
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending…';
    }

    var msgsEl = root.querySelector('.ac-msgs');
    if (msgsEl) {
      var now = new Date();
      var meta = now.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      var bubble = document.createElement('div');
      bubble.className = 'ac-bubble out';
      if (imageUrl) {
        var previewImg = document.createElement('img');
        previewImg.src = imageUrl;
        previewImg.style.cssText = 'max-width:180px;max-height:180px;border-radius:8px;display:block;margin-bottom:4px;';
        bubble.appendChild(previewImg);
      }
      if (message) {
        var textNode = document.createTextNode(message);
        bubble.appendChild(textNode);
      }
      var metaDiv = document.createElement('div');
      metaDiv.className = 'ac-meta';
      metaDiv.textContent = meta;
      bubble.appendChild(metaDiv);
      msgsEl.appendChild(bubble);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    input.value = '';
    clearStagedImage(root);

    var body = { message: message };
    if (imageUrl) body.image = imageUrl;

    apiPost(config, WIDGET_PATH_PREFIX + '/text-messages/thread/' + encodeURIComponent(recipientId), body)
      .then(function () {
        if (sendBtn) {
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send';
        }
      })
      .catch(function () {
        if (sendBtn) {
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send';
        }
        if (msgsEl && msgsEl.lastElementChild) {
          msgsEl.lastElementChild.style.opacity = '0.5';
          var err = document.createElement('div');
          err.className = 'ac-sys';
          err.textContent = 'Failed to send. Please try again.';
          err.style.color = '#c0392b';
          msgsEl.appendChild(err);
          msgsEl.scrollTop = msgsEl.scrollHeight;
        }
      });
  }

  function updateNavBadge(count) {
    const badge = document.getElementById('aftercare-text-nav-badge');
    if (badge) {
      badge.textContent = count > 0 ? count : '';
    }
  }

  // ============================================================
  // STYLES (injected into shadow DOM)
  // ============================================================
  function getStyles() {
    const S = '.ac-root';
    return `
:host { display: block; height: 100%; }
${S} { font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; flex-direction: column; height: 100%; color: #1a1a2e; }
${S} * { margin: 0; padding: 0; box-sizing: border-box; }

/* Scrollbar reset – prevent host-page ::-webkit-scrollbar styles from leaking in */
${S} *::-webkit-scrollbar { width: 6px; height: 6px; }
${S} *::-webkit-scrollbar-track { background: transparent; }
${S} *::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 3px; }
${S} *::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.25); }
${S} * { scrollbar-width: thin; scrollbar-color: rgba(0,0,0,0.15) transparent; }

/* Top bar */
${S} .ac-topbar { display: flex; align-items: center; justify-content: space-between; padding: 12px 24px; background: #fff; border-bottom: 1px solid #e2e6ec; flex-shrink: 0; }
${S} .ac-topbar-left { font-size: 18px; font-weight: 700; color: #1a1a2e; }
${S} .ac-topbar-settings { font-family: inherit; font-size: 13px; font-weight: 500; color: #4a6cf7; cursor: pointer; padding: 7px 14px; border: 1px solid #dde1e8; border-radius: 6px; background: #fff; transition: all 0.15s; }
${S} .ac-topbar-settings:hover:not(:disabled) { border-color: #4a6cf7; background: #f0f3ff; }
${S} .ac-topbar-settings:disabled { opacity: 0.65; cursor: not-allowed; }

/* Product gate (ACP-only accounts: no text inbox) */
${S} .ac-product-gate { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 24px; background: #fff; min-height: 180px; }
${S} .ac-gate-loading { font-size: 15px; color: #8b8fa3; }
${S} .ac-gate-acp-only { text-align: center; max-width: 380px; transform: translateY(-300px); }
${S} .ac-gate-copy { font-size: 15px; line-height: 1.55; color: #1a1a2e; margin-bottom: 20px; }
${S} .ac-acp-login-btn { font-family: inherit; }
${S} .ac-text-ui { display: none; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }

/* Inbox layout */
${S} .ac-inbox { display: flex; flex: 1; overflow: hidden; }

/* Message list */
${S} .ac-list { width: 300px; min-width: 300px; background: #fff; border-right: 1px solid #e2e6ec; display: flex; flex-direction: column; }
${S} .ac-list-msgs { flex: 1; overflow-y: auto; }
${S} .ac-group-hdr { padding: 10px 16px; font-size: 11px; font-weight: 600; color: #c0392b; text-transform: uppercase; letter-spacing: 0.5px; background: #fef8f7; border-bottom: 1px solid #fde8e5; display: flex; align-items: center; gap: 6px; }
${S} .ac-group-count { font-size: 10px; background: #e74c3c; color: #fff; padding: 1px 6px; border-radius: 8px; font-weight: 700; }
${S} .ac-divider { height: 1px; background: #dde1e8; margin: 12px 16px; }
${S} .ac-msg { display: flex; align-items: flex-start; padding: 14px 16px; border-bottom: 1px solid #f0f2f5; cursor: pointer; transition: background 0.15s; }
${S} .ac-msg:hover { background: #f8f9fb; }
${S} .ac-msg.active { background: #eef2ff; border-left: 3px solid #4a6cf7; padding-left: 13px; }
${S} .ac-msg-ind { width: 20px; min-width: 20px; padding-top: 4px; }
${S} .ac-sparkle { font-size: 13px; color: #e74c3c; font-weight: 700; }
${S} .ac-msg-body { flex: 1; min-width: 0; }
${S} .ac-msg-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px; }
${S} .ac-msg-name { font-weight: 600; font-size: 14px; }
${S} .ac-msg-date { font-size: 12px; color: #8b8fa3; white-space: nowrap; }
${S} .ac-msg-preview { font-size: 13px; color: #5a5d72; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${S} .ac-dismiss { font-size: 11px; color: #8b8fa3; margin-top: 4px; cursor: pointer; transition: color 0.15s; }
${S} .ac-dismiss:hover { color: #4a6cf7; }

/* Conversation */
${S} .ac-convo { flex: 1; display: flex; flex-direction: column; background: #f8f9fb; }
${S} .ac-convo-hdr { padding: 14px 24px; background: #fff; border-bottom: 1px solid #e2e6ec; display: flex; align-items: center; gap: 16px; }
${S} .ac-convo-name { font-size: 15px; font-weight: 600; color: #1a1a2e; }
${S} .ac-convo-phone { font-size: 12px; color: #8b8fa3; margin-top: 1px; }
${S} .ac-convo-sep { width: 1px; height: 32px; background: #e2e6ec; }
${S} .ac-convo-dec { font-size: 14px; font-weight: 500; color: #5a5d72; }
${S} .ac-convo-ddate { font-size: 12px; color: #8b8fa3; margin-top: 1px; }
${S} .ac-msgs { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 24px; display: flex; flex-direction: column; gap: 12px; }
${S} .ac-sys { align-self: center; font-size: 11px; color: #8b8fa3; font-weight: 500; }
${S} .ac-bubble { max-width: 75%; padding: 12px 16px; border-radius: 12px; font-size: 14px; line-height: 1.5; }
${S} .ac-bubble.out { align-self: flex-end; background: #4a6cf7; color: #fff; border-bottom-right-radius: 4px; }
${S} .ac-bubble.in { align-self: flex-start; background: #fff; color: #1a1a2e; border: 1px solid #e2e6ec; border-bottom-left-radius: 4px; }
${S} .ac-bubble.in.flagged { border-color: #f59e0b; border-width: 1.5px; box-shadow: 0 0 0 1px rgba(245,158,11,0.15); }
${S} .ac-meta { font-size: 11px; opacity: 0.6; margin-top: 4px; }
${S} .ac-bubble.out .ac-meta { text-align: right; }
${S} .ac-flag { font-size: 12px; color: #92400e; font-weight: 500; padding: 4px 0; align-self: flex-start; }
${S} .ac-flag-notif { color: #b0956a; font-weight: 400; }

/* Reply bar */
${S} .ac-reply { padding: 16px 24px; background: #fff; border-top: 1px solid #e2e6ec; display: flex; gap: 12px; align-items: flex-end; }
${S} .ac-reply-wrap { flex: 1; display: flex; flex-direction: column; gap: 6px; }
${S} .ac-reply-input-row { position: relative; display: flex; align-items: center; }
${S} .ac-reply-input-row input[type=text] { width: 100%; padding: 10px 70px 10px 14px; border: 1px solid #dde1e8; border-radius: 8px; font-size: 14px; font-family: inherit; background: #f8f9fb; outline: none; }
${S} .ac-reply-input-row input[type=text]:focus { border-color: #4a6cf7; }
${S} .ac-reply-icons { position: absolute; right: 8px; display: flex; gap: 2px; }
${S} .ac-img-chip { display: flex; align-items: center; gap: 8px; background: #f0f3ff; border: 1px solid #c5d0fb; border-radius: 8px; padding: 6px 10px; }
${S} .ac-img-thumb { height: 40px; width: 40px; object-fit: cover; border-radius: 4px; border: 1px solid #dde1e8; }
${S} .ac-img-chip-label { font-size: 12px; color: #4a6cf7; font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${S} .ac-img-chip-rm { background: none; border: none; cursor: pointer; color: #5a5d72; font-size: 14px; line-height: 1; padding: 2px 4px; border-radius: 4px; font-family: inherit; }
${S} .ac-img-chip-rm:hover { background: #e0e5ff; color: #e74c3c; }
${S} .ac-img-uploading { font-size: 12px; color: #8b8fa3; padding: 4px 0; }
${S} .ac-reply-ibtn { width: 30px; height: 30px; border: none; background: transparent; cursor: pointer; font-size: 16px; border-radius: 6px; display: flex; align-items: center; justify-content: center; opacity: 0.4; transition: opacity 0.15s; }
${S} .ac-reply-ibtn:hover { opacity: 0.8; }
${S} .ac-send-btn { padding: 10px 20px; background: #4a6cf7; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
${S} .ac-reply.suppressed { background: #fafafa; flex-direction: column; align-items: stretch; gap: 0; }
${S} .ac-suppressed { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: #f8f0e5; border: 1px solid #f0d8b0; border-radius: 8px; font-size: 13px; color: #8a6d00; line-height: 1.4; }
${S} .ac-suppressed-icon { font-size: 18px; flex-shrink: 0; }

/* Emoji picker */
${S} .ac-emoji-panel { display: none; position: absolute; bottom: 44px; right: 0; width: 280px; background: #fff; border: 1px solid #e2e6ec; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 100; padding: 10px; animation: acModalIn 0.15s ease; }
${S} .ac-emoji-panel.visible { display: block; }
${S} .ac-emoji-tabs { display: flex; gap: 2px; border-bottom: 1px solid #f0f2f5; padding-bottom: 6px; margin-bottom: 6px; }
${S} .ac-emoji-tab { flex: 1; text-align: center; font-size: 16px; padding: 4px 0; cursor: pointer; border-radius: 6px; border: none; background: transparent; transition: background 0.12s; }
${S} .ac-emoji-tab:hover { background: #f0f2f5; }
${S} .ac-emoji-tab.active { background: #eef2ff; }
${S} .ac-emoji-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; max-height: 180px; overflow-y: auto; }
${S} .ac-emoji-grid button { font-size: 20px; width: 34px; height: 34px; border: none; background: transparent; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.12s; }
${S} .ac-emoji-grid button:hover { background: #f0f2f5; }

/* Detail panel */
${S} .ac-detail { width: 260px; min-width: 260px; background: #fff; border-left: 1px solid #e2e6ec; padding: 20px; overflow-y: auto; }
${S} .ac-detail h4 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #8b8fa3; margin-bottom: 10px; }
${S} .ac-sched { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid #f5f7fa; cursor: pointer; transition: background 0.15s; font-size: 13px; }
${S} .ac-sched:last-of-type { border-bottom: none; }
${S} .ac-sched:hover { background: #f8f9fb; margin: 0 -8px; padding: 8px 8px; border-radius: 6px; }
${S} .ac-sched-check { width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0; background: #2ecc71; color: #fff; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
${S} .ac-sched-pend { width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0; border: 2px solid #dde1e8; }
${S} .ac-sched-name { flex: 1; font-weight: 500; }
${S} .ac-sched-date { color: #8b8fa3; font-size: 12px; white-space: nowrap; }
${S} .ac-stop-wrap { margin-top: 16px; padding-top: 12px; border-top: 1px solid #f0f2f5; }
${S} .ac-stop { text-align: center; padding: 8px 0; font-size: 13px; color: #8b8fa3; cursor: pointer; transition: color 0.15s; }
${S} .ac-stop:hover { color: #c0392b; }

/* Modals */
${S} .ac-modal-bg { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(26,26,46,0.5); z-index: 9000; align-items: center; justify-content: center; }
${S} .ac-modal-bg.visible { display: flex; }
@keyframes acModalIn { from { opacity: 0; transform: scale(0.95) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
${S} .ac-modal { width: 480px; max-width: 90vw; background: #fff; border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,0.2); overflow: hidden; animation: acModalIn 0.2s ease; }
${S} .ac-modal-top { display: flex; justify-content: space-between; align-items: flex-start; padding: 20px 24px 16px; }
${S} .ac-modal-title { font-size: 16px; font-weight: 700; color: #1a1a2e; }
${S} .ac-modal-timing { font-size: 12px; color: #8b8fa3; margin-top: 2px; }
${S} .ac-modal-close { width: 32px; height: 32px; border-radius: 8px; border: none; background: #f0f2f5; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; color: #5a5d72; }
${S} .ac-modal-msg { margin: 0 24px 20px; padding: 16px; background: #f0f3ff; border: 1px solid #dde3f7; border-radius: 10px; font-size: 14px; line-height: 1.6; color: #1a1a2e; white-space: pre-line; }
${S} .ac-modal-foot { padding: 16px 24px; border-top: 1px solid #edf0f4; display: flex; justify-content: space-between; align-items: center; }
${S} .ac-modal-del { padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; border: 1px solid #f5c6c6; background: #fff; color: #c0392b; cursor: pointer; font-family: inherit; transition: all 0.15s; }
${S} .ac-modal-del:hover { background: #fdf0f0; border-color: #e74c3c; }
${S} .ac-modal-done { padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; border: 1px solid #dde1e8; background: #fff; color: #5a5d72; cursor: pointer; font-family: inherit; }

/* Stop confirm modal */
${S} .ac-confirm { width: 420px; max-width: 90vw; background: #fff; border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,0.2); overflow: hidden; animation: acModalIn 0.2s ease; padding: 28px; }
${S} .ac-confirm h3 { font-size: 18px; font-weight: 700; margin-bottom: 12px; }
${S} .ac-confirm p { font-size: 14px; color: #5a5d72; line-height: 1.6; margin-bottom: 8px; }
${S} .ac-confirm-warn { background: #fff8e5; border: 1px solid #f0d060; border-radius: 8px; padding: 12px; font-size: 13px; color: #8a6d00; margin: 16px 0; }
${S} .ac-confirm-acts { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; }
${S} .ac-confirm-acts button { padding: 9px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; border: none; }
${S} .ac-cancel-btn { background: #f0f2f5; color: #5a5d72; }
${S} .ac-stop-btn { background: #e74c3c; color: #fff; }
`;
  }

  // ============================================================
  // HTML
  // ============================================================
  function getHTML() {
    return `
<div id="ac-product-gate" class="ac-product-gate">
  <div id="ac-gate-loading" class="ac-gate-loading">Loading…</div>
  <div id="ac-gate-acp-only" class="ac-gate-acp-only" style="display:none">
    <p class="ac-gate-copy">Click below to open Aftercare.com.</p>
    <button type="button" class="ac-acp-login-btn ac-topbar-settings" id="ac-gate-login-btn">Open Aftercare.com</button>
  </div>
</div>
<div id="ac-text-ui" class="ac-text-ui" style="display:none">
<!-- Aftercare top bar -->
<div class="ac-topbar">
  <div class="ac-topbar-left">Aftercare Text</div>
  <button type="button" class="ac-topbar-settings" id="ac-open-admin-btn">Open Aftercare.com</button>
</div>

<!-- Inbox -->
<div class="ac-inbox">
  <!-- Message list -->
  <div class="ac-list">
    <div class="ac-list-msgs">
      <div class="ac-list-loading" style="padding:24px;text-align:center;color:#8b8fa3;font-size:14px;">Loading conversations…</div>
    </div>
  </div>

  <!-- Conversation -->
  <div class="ac-convo">
    <div class="ac-convo-hdr">
      <div>
        <div class="ac-convo-name"></div>
        <div class="ac-convo-phone"></div>
      </div>
      <div class="ac-convo-sep" style="display:none"></div>
      <div style="display:none">
        <div class="ac-convo-dec"></div>
        <div class="ac-convo-ddate"></div>
      </div>
    </div>
    <div class="ac-msgs">
      <div class="ac-sys">Loading messages…</div>
    </div>
    <div class="ac-reply" id="ac-reply-bar">
      <div class="ac-reply-wrap">
        <div class="ac-img-chip" id="ac-img-chip" style="display:none">
          <img class="ac-img-thumb" id="ac-img-thumb" src="" alt="attachment" />
          <span class="ac-img-chip-label" id="ac-img-chip-label"></span>
          <button type="button" class="ac-img-chip-rm" id="ac-img-chip-rm" title="Remove image">✕</button>
        </div>
        <div class="ac-reply-input-row">
          <input class="message-input" name="message" type="text" placeholder="" />
          <input type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif" id="ac-img-file" style="display:none" />
          <div class="ac-reply-icons">
            <button type="button" class="ac-reply-ibtn ac-emoji-btn" title="Emoji">😊</button>
            <button type="button" class="ac-reply-ibtn ac-img-btn" title="Attach image">🖼️</button>
          </div>
          <div class="ac-emoji-panel" id="ac-emoji-panel"></div>
        </div>
      </div>
      <button class="ac-send-btn">Send</button>
    </div>
  </div>

  <!-- Detail panel -->
  <div class="ac-detail">
    <div>
      <h4>Message Schedule</h4>
      <div id="ac-schedule-list" class="ac-schedule-list"></div>
    </div>
    <div class="ac-stop-wrap" id="ac-stop-wrap">
      <div class="ac-stop" id="ac-stop-link">🚫 Stop future messages</div>
    </div>
  </div>
</div>

<!-- Message Preview Modal -->
<div class="ac-modal-bg" id="ac-msg-modal">
  <div class="ac-modal">
    <div class="ac-modal-top">
      <div>
        <div class="ac-modal-title" id="ac-modal-title"></div>
        <div class="ac-modal-timing" id="ac-modal-timing"></div>
      </div>
      <button class="ac-modal-close" id="ac-modal-close-btn">✕</button>
    </div>
    <div class="ac-modal-msg" id="ac-modal-msg"></div>
    <div class="ac-modal-foot">
      <button class="ac-modal-del" id="ac-modal-del">🗑 Delete message from schedule</button>
      <button class="ac-modal-done" id="ac-modal-done-btn">Close</button>
    </div>
  </div>
</div>

<!-- Stop Confirm Modal -->
<div class="ac-modal-bg" id="ac-stop-modal">
  <div class="ac-confirm">
    <h3>Stop all scheduled messages?</h3>
    <p>This will cancel all future scheduled text messages for this family and suppress their phone number from receiving any further texts.</p>
    <div class="ac-confirm-warn">⚠️ This action cannot be undone.</div>
    <p style="font-size:13px;">All remaining scheduled messages for this recipient will be cancelled.</p>
    <div class="ac-confirm-acts">
      <button class="ac-cancel-btn" id="ac-stop-cancel">Cancel</button>
      <button class="ac-stop-btn" id="ac-stop-confirm">Stop All Messages</button>
    </div>
  </div>
</div>
</div>
`;
  }

  // ============================================================
  // EVENT BINDING
  // ============================================================
  function bindEvents(root) {
    wireAftercareAdminButton(root, '#ac-open-admin-btn', 'Open Aftercare.com');
    root.querySelector('#ac-modal-close-btn').addEventListener('click', () => {
      root.querySelector('#ac-msg-modal').classList.remove('visible');
    });
    root.querySelector('#ac-modal-done-btn').addEventListener('click', () => {
      root.querySelector('#ac-msg-modal').classList.remove('visible');
    });
    root.querySelector('#ac-msg-modal').addEventListener('click', (e) => {
      if (e.target === root.querySelector('#ac-msg-modal')) {
        root.querySelector('#ac-msg-modal').classList.remove('visible');
      }
    });

    // Delete scheduled message
    root.querySelector('#ac-modal-del').addEventListener('click', function () {
      var delBtn = root.querySelector('#ac-modal-del');
      var schedId = delBtn.dataset.scheduleId;
      if (!schedId) return;

      var config = getConfig(root);
      delBtn.disabled = true;
      delBtn.textContent = 'Deleting…';

      // account_api_key (the tukios_api_key stored on the accounts table) is sent via the
      // Authorization: Bearer <account_api_key> header by jsonHeaders(config), not as a query param.
      apiDelete(config, WIDGET_PATH_PREFIX + '/aftercare-families/schedule/' + encodeURIComponent(schedId), { type: 'text' })
        .then(function () {
          root.querySelector('#ac-msg-modal').classList.remove('visible');
          delBtn.disabled = false;
          delBtn.innerHTML = '🗑 Delete message from schedule';

          var schedEl = root.querySelector('.ac-sched[data-id="' + schedId + '"]');
          if (schedEl) {
            schedEl.style.transition = 'opacity 0.3s';
            schedEl.style.opacity = '0';
            setTimeout(function () { schedEl.remove(); }, 300);
          }
        })
        .catch(function () {
          delBtn.disabled = false;
          delBtn.innerHTML = '🗑 Delete message from schedule';
          delBtn.style.borderColor = '#e74c3c';
          delBtn.style.color = '#e74c3c';
          setTimeout(function () {
            delBtn.style.borderColor = '';
            delBtn.style.color = '';
          }, 2000);
        });
    });

    // Stop link → open confirm
    root.querySelector('#ac-stop-link').addEventListener('click', () => {
      root.querySelector('#ac-stop-modal').classList.add('visible');
    });

    // Stop confirm cancel
    root.querySelector('#ac-stop-cancel').addEventListener('click', () => {
      root.querySelector('#ac-stop-modal').classList.remove('visible');
    });
    root.querySelector('#ac-stop-modal').addEventListener('click', (e) => {
      if (e.target === root.querySelector('#ac-stop-modal')) {
        root.querySelector('#ac-stop-modal').classList.remove('visible');
      }
    });

    // Stop confirm execute
    root.querySelector('#ac-stop-confirm').addEventListener('click', () => {
      var config = getConfig(root);
      var activeMsg = root.querySelector('.ac-msg.active');
      var input = root.querySelector('#ac-reply-bar .message-input');
      var recipientId = (activeMsg && (activeMsg.dataset.recipientId || activeMsg.dataset.id))
        || (input && input.dataset.recipientId);

      if (!recipientId) return;

      var confirmBtn = root.querySelector('#ac-stop-confirm');
      var cancelBtn = root.querySelector('#ac-stop-cancel');
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Stopping…';
      cancelBtn.disabled = true;

      apiPost(config, WIDGET_PATH_PREFIX + '/text-messages/stop/' + encodeURIComponent(recipientId))
        .then(function () {
          root.querySelector('#ac-stop-modal').classList.remove('visible');
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Stop All Messages';
          cancelBtn.disabled = false;

          var replyBar = root.querySelector('#ac-reply-bar');
          replyBar.className = 'ac-reply suppressed';
          replyBar.innerHTML = '<div class="ac-suppressed"><span class="ac-suppressed-icon">🚫</span><div>This family no longer wants to receive messages. Their number has been suppressed and all future messages have been cancelled.</div></div>';
          root.querySelector('#ac-stop-wrap').style.display = 'none';
          root.querySelectorAll('.ac-sched:not(.sent)').forEach(function (item) {
            item.style.opacity = '0.35';
            item.style.textDecoration = 'line-through';
            item.style.pointerEvents = 'none';
          });
        })
        .catch(function () {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Stop All Messages';
          cancelBtn.disabled = false;

          var warn = root.querySelector('.ac-confirm-warn');
          if (warn) {
            warn.textContent = '❌ Failed to stop messages. Please try again.';
            warn.style.color = '#c0392b';
          }
        });
    });

    // Emoji picker
    var emojiCategories = {
      '😊': ['😊','😂','❤️','🙏','👍','😢','🥰','😘','💕','🤗','😇','🕊️','💐','🌹','🌻','✨','💫','🌈','☀️','🕯️','💜','💙','🤍','🖤','💛','🧡','💚','❣️'],
      '👋': ['👋','👍','👏','🤝','💪','🙌','✌️','🤞','👆','👇','👉','👈','🫶','❤️‍🩹','🫂','💆','🧎','🚶','🧍','👨‍👩‍👧','👨‍👩‍👧‍👦','👪','👫','👬','👭','🧓','👵','👴'],
      '🌸': ['🌸','🌺','🌷','🌹','🌻','🌼','💐','🪻','🌿','🍃','🍂','🌳','🕊️','🦋','🐦','🌅','🌄','⭐','🌙','☁️','🌊','🏔️','🌾','🪴','🕯️','🔔','🎵','🎶'],
      '🙏': ['🙏','✝️','✡️','☪️','🕉️','☮️','🕊️','⛪','🕌','🕍','📿','🛐','💒','⚰️','🪦','🏵️','🎗️','🎀','📖','📜','🤲','🧎','😇','👼','💫','✨','🌟','💝'],
    };
    var emojiTabKeys = Object.keys(emojiCategories);
    var emojiPanel = root.querySelector('#ac-emoji-panel');
    var emojiBtn = root.querySelector('.ac-emoji-btn');

    function buildEmojiPanel(activeIdx) {
      if (!emojiPanel) return;
      var tabsHtml = '<div class="ac-emoji-tabs">';
      emojiTabKeys.forEach(function (key, i) {
        tabsHtml += '<button class="ac-emoji-tab' + (i === activeIdx ? ' active' : '') + '" data-tab="' + i + '">' + key + '</button>';
      });
      tabsHtml += '</div>';
      var gridHtml = '<div class="ac-emoji-grid">';
      emojiCategories[emojiTabKeys[activeIdx]].forEach(function (em) {
        gridHtml += '<button data-emoji="' + em + '">' + em + '</button>';
      });
      gridHtml += '</div>';
      emojiPanel.innerHTML = tabsHtml + gridHtml;

      emojiPanel.querySelectorAll('.ac-emoji-tab').forEach(function (tab) {
        tab.addEventListener('click', function (e) {
          e.stopPropagation();
          buildEmojiPanel(parseInt(tab.dataset.tab, 10));
        });
      });
      emojiPanel.querySelectorAll('.ac-emoji-grid button').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var input = root.querySelector('#ac-reply-bar .message-input');
          if (input) {
            var start = input.selectionStart || input.value.length;
            var end = input.selectionEnd || input.value.length;
            input.value = input.value.slice(0, start) + btn.dataset.emoji + input.value.slice(end);
            input.focus();
            var pos = start + btn.dataset.emoji.length;
            input.setSelectionRange(pos, pos);
          }
        });
      });
    }

    if (emojiBtn && emojiPanel) {
      buildEmojiPanel(0);
      emojiBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        emojiPanel.classList.toggle('visible');
      });
      emojiPanel.addEventListener('click', function (e) {
        e.stopPropagation();
      });
      document.addEventListener('click', function () {
        emojiPanel.classList.remove('visible');
      });
    }

    // Image upload
    var imgBtn = root.querySelector('.ac-img-btn');
    var imgFileInput = root.querySelector('#ac-img-file');
    var imgChip = root.querySelector('#ac-img-chip');
    var imgThumb = root.querySelector('#ac-img-thumb');
    var imgChipLabel = root.querySelector('#ac-img-chip-label');
    var imgChipRm = root.querySelector('#ac-img-chip-rm');

    if (imgBtn && imgFileInput) {
      imgBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        imgFileInput.click();
      });

      imgFileInput.addEventListener('change', function () {
        var file = imgFileInput.files && imgFileInput.files[0];
        if (!file) return;

        // Show a local object-URL preview immediately while uploading
        var localUrl = URL.createObjectURL(file);
        if (imgThumb) { imgThumb.src = localUrl; imgThumb.dataset.s3Url = ''; }
        if (imgChipLabel) imgChipLabel.textContent = 'Uploading…';
        if (imgChip) imgChip.style.display = 'flex';
        if (imgBtn) imgBtn.disabled = true;

        var config = getConfig(root);
        var formData = new FormData();
        formData.append('file', file);

        apiPostFormData(config, WIDGET_PATH_PREFIX + '/text-messages/upload-image', formData)
          .then(function (data) {
            var s3Url = data && data.url;
            if (!s3Url) throw new Error('No URL in response');
            if (imgThumb) imgThumb.dataset.s3Url = s3Url;
            if (imgChipLabel) imgChipLabel.textContent = file.name;
            if (imgBtn) imgBtn.disabled = false;
          })
          .catch(function () {
            // Upload failed — clear the chip and show a brief error on the button
            clearStagedImage(root);
            if (imgBtn) {
              imgBtn.disabled = false;
              imgBtn.title = 'Upload failed — try again';
              setTimeout(function () { imgBtn.title = 'Attach image'; }, 3000);
            }
          });
      });
    }

    if (imgChipRm) {
      imgChipRm.addEventListener('click', function () {
        clearStagedImage(root);
      });
    }

    // Send message
    var sendBtn = root.querySelector('.ac-send-btn');
    if (sendBtn) {
      sendBtn.addEventListener('click', function () {
        sendMessage(root);
      });
    }
    var msgInput = root.querySelector('#ac-reply-bar .message-input');
    if (msgInput) {
      msgInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage(root);
        }
      });
    }

  }

  // ============================================================
  // INITIALIZATION
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Also observe for SPA navigation (React re-renders)
  const rootObserver = new MutationObserver(() => {
    const root = document.getElementById('aftercare-text-root');
    if (root && !root.dataset.aftercareInit) {
      init();
    }
  });
  rootObserver.observe(document.body, { childList: true, subtree: true });

})();
