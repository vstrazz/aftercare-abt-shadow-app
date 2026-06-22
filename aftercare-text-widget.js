/**
 * Aftercare Text Widget V1.2.0
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
 *
 * Realtime inbox updates use FIREBASE_DB_URL, injected when you run npm run sync-widget
 * (or npm run build). AFTERCARE_CONFIG.firebaseDbUrl can override for local dev.
 */
(function () {
  'use strict';

  const DEFAULT_API_BASE = 'https://aftercare-app-api-18edbb932ed8.herokuapp.com/api/';
  // Global API client key (matches API_CLIENT_KEYS on the API). Sent as
  // X-API-Key on every request to satisfy the global requireApiKey gate.
  // Hosts can override via data-api-key or AFTERCARE_CONFIG.apiKey.
  const DEFAULT_API_KEY = '';
  // account_api_key refers to the tukios_api_key stored on the accounts table.
  const DEFAULT_ACCOUNT_API_KEY = '1';
  // Injected from FIREBASE_DB_URL via scripts/inject-widget-env.mjs (npm run sync-widget).
  const DEFAULT_FIREBASE_DB_URL = '@@FIREBASE_DB_URL@@';
  // All widget calls go through the per-account auth wrapper mounted at
  // /api/widget/* on the API. The underlying handlers (text-messages,
  // aftercare-families) are re-mounted there with widgetAuth, which
  // resolves the bearer key to an account.id and injects it into the
  // request before the public handlers run. The original public routes
  // (e.g. /api/text-messages/*) remain unchanged for other consumers.
  const WIDGET_PATH_PREFIX = 'widget';

  var _inboxSignal = null;
  var _inboxSignalDebounce = null;
  var _lastInboxSignalKey = null;

  function parseSSEBuffer(buffer) {
    var events = [];
    var normalized = buffer.replace(/\r\n/g, '\n');
    var parts = normalized.split('\n\n');
    var remainder = parts.pop() || '';
    for (var i = 0; i < parts.length; i++) {
      var block = parts[i].trim();
      if (!block) continue;
      var lines = block.split('\n');
      var eventName = 'message';
      var dataLines = [];
      for (var j = 0; j < lines.length; j++) {
        var line = lines[j];
        if (line.indexOf('event:') === 0) {
          eventName = line.slice(6).trim();
        } else if (line.indexOf('data:') === 0) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      if (dataLines.length) {
        events.push({ event: eventName, data: dataLines.join('\n') });
      }
    }
    return { events: events, remainder: remainder };
  }

  function parseInboxSignalPayload(rawData) {
    if (!rawData || rawData === 'null') return null;
    try {
      var envelope = JSON.parse(rawData);
      var payload = envelope && envelope.data != null ? envelope.data : envelope;
      if (!payload || typeof payload !== 'object') return null;
      return {
        recipientId: payload.recipientId != null ? payload.recipientId : payload.recipient_id,
        type: payload.type || '',
        updatedAt: payload.updatedAt != null ? payload.updatedAt : payload.updated_at,
      };
    } catch (e) {
      return null;
    }
  }

  function scheduleInboxRefresh(root, signal) {
    var signalKey = String(signal.updatedAt || '') + ':' + String(signal.type || '') + ':' +
      String(signal.recipientId != null ? signal.recipientId : '');
    if (signalKey === _lastInboxSignalKey) return;
    _lastInboxSignalKey = signalKey;

    clearTimeout(_inboxSignalDebounce);
    _inboxSignalDebounce = setTimeout(function () {
      var config = getConfig(root);
      refreshConversationList(root);
      refreshUnreadBadge(root, config);
      var active = root.querySelector('.ac-msg.active');
      var activeId = active && (active.dataset.recipientId || active.dataset.id);
      if (!activeId) return;
      var signalRid = signal.recipientId != null ? String(signal.recipientId) : null;
      if (!signalRid || signalRid === String(activeId)) {
        refreshThread(root, activeId);
      }
    }, 300);
  }

  function connectInboxSignal(root, accountId) {
    disconnectInboxSignal();

    var config = getConfig(root);
    if (!accountId || !config.firebaseDbUrl || config.firebaseDbUrl === '@@FIREBASE_DB_URL@@') return;

    var streamUrl = config.firebaseDbUrl.replace(/\/$/, '') +
      '/signals/' + encodeURIComponent(String(accountId)) + '/inbox.json';
    var controller = new AbortController();
    var closed = false;
    var boundAccountId = accountId;

    _inboxSignal = {
      close: function () {
        closed = true;
        controller.abort();
      },
    };

    function scheduleReconnect() {
      if (closed) return;
      setTimeout(function () {
        if (!closed) connectInboxSignal(root, boundAccountId);
      }, 5000);
    }

    function readStream(reader, decoder, buffer) {
      return reader.read().then(function (result) {
        if (closed) return;
        if (result.done) {
          scheduleReconnect();
          return;
        }
        buffer += decoder.decode(result.value, { stream: true });
        var parsed = parseSSEBuffer(buffer);
        buffer = parsed.remainder;
        for (var i = 0; i < parsed.events.length; i++) {
          var evt = parsed.events[i];
          if (evt.event === 'keep-alive' || evt.event === 'cancel') continue;
          if (evt.event !== 'put' && evt.event !== 'patch') continue;
          var signal = parseInboxSignalPayload(evt.data);
          if (signal) scheduleInboxRefresh(root, signal);
        }
        return readStream(reader, decoder, buffer);
      });
    }

    fetch(streamUrl, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    }).then(function (res) {
      if (closed) return;
      if (!res.ok) throw new Error(res.statusText || 'Inbox signal stream failed');
      if (!res.body || !res.body.getReader) throw new Error('Streaming not supported');
      return readStream(res.body.getReader(), new TextDecoder(), '');
    }).catch(function (err) {
      if (closed || err.name === 'AbortError') return;
      console.warn('[aftercare-text-widget] inbox signal error:', err);
      scheduleReconnect();
    });
  }

  function disconnectInboxSignal() {
    if (_inboxSignalDebounce) {
      clearTimeout(_inboxSignalDebounce);
      _inboxSignalDebounce = null;
    }
    _lastInboxSignalKey = null;
    if (_inboxSignal) {
      _inboxSignal.close();
      _inboxSignal = null;
    }
  }

  function stripApiTimestamp(raw) {
    if (raw == null || raw === '') return '';
    if (raw instanceof Date) {
      if (isNaN(raw.getTime())) return '';
      return stripApiTimestamp(raw.toISOString());
    }
    var s = String(raw).trim();
    return s.replace(/\.\d{3}Z?$/, '').replace(/Z$/, '');
  }

  function parseWallClockDate(raw) {
    if (!raw) return new Date(NaN);
    if (raw instanceof Date) return raw;
    var s = stripApiTimestamp(raw);
    if (!s) return new Date(NaN);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      return new Date(
        parseInt(m[1], 10),
        parseInt(m[2], 10) - 1,
        parseInt(m[3], 10),
        parseInt(m[4] || '0', 10),
        parseInt(m[5] || '0', 10),
        parseInt(m[6] || '0', 10)
      );
    }
    return new Date(s);
  }

  function wallClockNowEastern() {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    var get = function (type) {
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === type) return parts[i].value;
      }
      return '00';
    };
    return get('year') + '-' + get('month') + '-' + get('day') + 'T' +
      get('hour') + ':' + get('minute') + ':' + get('second');
  }

  function extractMessageTimestamp(msg) {
    if (!msg) return '';
    return msg.entry_date
      || msg.entryDate
      || msg.createdAt
      || msg.created_at
      || msg.sentAt
      || msg.send_date
      || msg.sendDate
      || msg.at
      || msg.date
      || msg.timestamp
      || '';
  }

  function formatMessageMeta(rawDate) {
    var d = parseWallClockDate(rawDate);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function formatCalendarDate(raw) {
    if (!raw) return '';
    var s = typeof raw === 'string' ? raw.trim() : '';
    // Date-only values should be rendered as-is to avoid timezone day shifts.
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
    if (m) {
      return parseInt(m[2], 10) + '/' + parseInt(m[3], 10) + '/' + parseInt(m[1], 10);
    }
    var d = new Date(raw);
    if (isNaN(d.getTime())) return '';
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '/' + d.getUTCFullYear();
  }

  function extractMessageReaction(msg) {
    if (!msg) return '';
    return msg.reaction != null
      ? msg.reaction
      : (msg.message_reaction != null ? msg.message_reaction : (msg.messageReaction != null ? msg.messageReaction : ''));
  }

  function extractMessageId(msg) {
    if (!msg) return '';
    var id = msg.id != null ? msg.id : (msg.message_id != null ? msg.message_id : msg.messageId);
    return id != null ? String(id) : '';
  }

  function hasReactionField(msg) {
    if (!msg) return false;
    return Object.prototype.hasOwnProperty.call(msg, 'reaction')
      || Object.prototype.hasOwnProperty.call(msg, 'message_reaction')
      || Object.prototype.hasOwnProperty.call(msg, 'messageReaction');
  }

  function extractMessageImage(msg) {
    if (!msg) return '';
    return msg.image != null
      ? msg.image
      : (msg.media_url != null ? msg.media_url : (msg.mediaUrl != null ? msg.mediaUrl : ''));
  }

  function hasImageField(msg) {
    if (!msg) return false;
    return Object.prototype.hasOwnProperty.call(msg, 'image')
      || Object.prototype.hasOwnProperty.call(msg, 'media_url')
      || Object.prototype.hasOwnProperty.call(msg, 'mediaUrl');
  }

  function setBubbleContent(bubble, body, meta, image, reaction) {
    var mediaOnly = !body && !!image;
    bubble.classList.toggle('media-only', mediaOnly);
    var imgHtml = image
      ? '<div class="ac-image-wrap"><img class="ac-msg-image" src="' + escapeAttr(image) + '" /></div>'
      : '';
    var reactionHtml = reaction ? '<div class="ac-reaction-badge">' + escapeHtml(reaction) + '</div>' : '';
    bubble.innerHTML = reactionHtml + linkifyMessageText(body) + imgHtml + '<div class="ac-meta">' + escapeHtml(meta) + '</div>';
    bubble.dataset.messageBody = body;
    bubble.dataset.messageMeta = meta;
    bubble.dataset.messageImage = image;
    bubble.dataset.messageReaction = reaction;
  }

  function setBubbleContent(bubble, body, meta, image, reaction) {
    if (!c || typeof c !== 'object') return false;
    var last = c.last_message || c.lastMessage || {};
    var direct = c.needs_attention;
    if (direct == null) direct = c.needsAttention;
    if (direct == null) direct = c.recipient_needs_attention;
    if (direct == null) direct = c.recipientNeedsAttention;
    if (direct == null) direct = last.needs_attention;
    if (direct == null) direct = last.needsAttention;
    return direct === true || direct === 1 || direct === '1' || direct === 'true';
  }

  function threadRecipientNeedsAttention(inner, recipient) {
    var source = inner && typeof inner === 'object' ? inner : {};
    var rec = recipient && typeof recipient === 'object' ? recipient : {};
    var direct = source.recipient_needs_attention;
    if (direct == null) direct = source.recipientNeedsAttention;
    if (direct == null) direct = source.needs_attention;
    if (direct == null) direct = source.needsAttention;
    if (direct == null) direct = rec.needs_attention;
    if (direct == null) direct = rec.needsAttention;
    if (direct == null) direct = rec.recipient_needs_attention;
    if (direct == null) direct = rec.recipientNeedsAttention;
    return direct === true || direct === 1 || direct === '1' || direct === 'true';
  }

  function messageNeedsAttention(msg) {
    if (!msg || typeof msg !== 'object') return false;
    var direct = msg.needs_attention;
    if (direct == null) direct = msg.needsAttention;
    if (direct === true || direct === 1 || direct === '1' || direct === 'true') return true;

    var moderation = msg.moderation;
    if (Array.isArray(moderation)) {
      return moderation.some(function (entry) {
        if (!entry || typeof entry !== 'object') return false;
        return entry.needs_attention === true
          || entry.needsAttention === true
          || entry.needs_attention === 1
          || entry.needsAttention === 1
          || entry.needs_attention === '1'
          || entry.needsAttention === '1'
          || entry.needs_attention === 'true'
          || entry.needsAttention === 'true';
      });
    }
    if (moderation && typeof moderation === 'object') {
      return moderation.needs_attention === true
        || moderation.needsAttention === true
        || moderation.needs_attention === 1
        || moderation.needsAttention === 1
        || moderation.needs_attention === '1'
        || moderation.needsAttention === '1'
        || moderation.needs_attention === 'true'
        || moderation.needsAttention === 'true';
    }
    return false;
  }

  function scrollMessagesToBottom(msgsEl) {
    if (!msgsEl) return;

    var doScroll = function () {
      msgsEl.scrollTop = msgsEl.scrollHeight;
    };

    // Immediate + follow-up passes to catch async layout.
    doScroll();
    requestAnimationFrame(doScroll);
    setTimeout(doScroll, 80);

    // Images load after HTML is inserted; keep the latest message pinned.
    msgsEl.querySelectorAll('img').forEach(function (img) {
      if (img.complete) return;
      img.addEventListener('load', doScroll, { once: true });
      img.addEventListener('error', doScroll, { once: true });
    });
  }

  function ensureOnlyLastFlaggedMessage(msgsEl) {
    if (!msgsEl) return;
    var incoming = Array.from(msgsEl.querySelectorAll('.ac-bubble.in'));
    if (!incoming.length) return;
    var recipientNeedsAttention = msgsEl.dataset.recipientNeedsAttention === '1';
    if (!recipientNeedsAttention) {
      incoming.forEach(function (bubble) {
        bubble.classList.remove('flagged');
      });
      return;
    }

    var attention = incoming.filter(function (bubble) {
      return bubble.dataset.needsAttention === '1';
    });
    var lastAttention = attention.length ? attention[attention.length - 1] : null;

    incoming.forEach(function (bubble) {
      if (bubble === lastAttention) bubble.classList.add('flagged');
      else bubble.classList.remove('flagged');
    });
  }

  function isCompactViewport() {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(max-width: 820px)').matches;
  }

  function applyResponsiveLayout(root) {
    if (!root) return;
    var compact = isCompactViewport();
    root.classList.toggle('ac-mobile', compact);
    if (!compact) {
      root.classList.remove('ac-mobile-list', 'ac-mobile-thread');
      return;
    }
    var view = root.dataset.mobileView === 'thread' ? 'thread' : 'list';
    root.classList.toggle('ac-mobile-list', view === 'list');
    root.classList.toggle('ac-mobile-thread', view === 'thread');
  }

  function setMobileView(root, view) {
    if (!root) return;
    root.dataset.mobileView = view === 'thread' ? 'thread' : 'list';
    applyResponsiveLayout(root);
  }

  function initResponsiveBehavior(root) {
    applyResponsiveLayout(root);
    if (root._onViewportChange) return;
    root._onViewportChange = function () {
      applyResponsiveLayout(root);
    };
    window.addEventListener('resize', root._onViewportChange);
  }

  function bindDismissLink(root, link) {
    if (!link || link.dataset.boundDismiss === '1') return;
    link.dataset.boundDismiss = '1';
    link.addEventListener('click', function (e) {
      e.stopPropagation();
      var id = link.dataset.resolve;
      if (!id) return;
      openClearAttentionConfirm(root, id, link);
    });
  }

  function rebuildConversationSections(root) {
    var listEl = root.querySelector('.ac-list-msgs');
    if (!listEl) return;

    var rows = Array.from(listEl.querySelectorAll('.ac-msg'));
    if (!rows.length) return;

    var attentionRows = rows.filter(function (row) {
      return row.dataset.needsAttention === '1';
    });
    updateNavBadge(attentionRows.length);
    bindListEvents(root);
  }

  function markConversationNeedsAttention(root, recipientId) {
    var item = root.querySelector('.ac-msg[data-recipient-id="' + recipientId + '"]')
      || root.querySelector('.ac-msg[data-id="' + recipientId + '"]');
    if (!item) return;

    var msgInd = item.querySelector('.ac-msg-ind');
    if (msgInd) {
      msgInd.innerHTML = '<span class="ac-alert-dot" aria-hidden="true"></span>';
    }
    item.dataset.needsAttention = '1';

    var body = item.querySelector('.ac-msg-body');
    if (!body) return;
    var attentionRow = body.querySelector('.ac-attention-row');
    if (!attentionRow) {
      attentionRow = document.createElement('div');
      attentionRow.className = 'ac-attention-row';
      attentionRow.innerHTML = '<span class="ac-attention-label">AI Flagged</span><div class="ac-dismiss" data-resolve="' + escapeAttr(String(recipientId)) + '">Clear</div>';
      body.appendChild(attentionRow);
    }
  }

  function openClearAttentionConfirm(root, recipientId, dismissLink) {
    var modal = root.querySelector('#ac-clear-attn-modal');
    var confirmBtn = root.querySelector('#ac-clear-attn-confirm');
    if (!modal || !confirmBtn) return;
    confirmBtn.dataset.recipientId = String(recipientId || '');
    root._clearAttentionDismissLink = dismissLink || null;
    modal.classList.add('visible');
  }

  function closeClearAttentionConfirm(root) {
    var modal = root.querySelector('#ac-clear-attn-modal');
    var confirmBtn = root.querySelector('#ac-clear-attn-confirm');
    if (confirmBtn) {
      confirmBtn.dataset.recipientId = '';
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Yes, resolve';
    }
    var cancelBtn = root.querySelector('#ac-clear-attn-cancel');
    if (cancelBtn) cancelBtn.disabled = false;
    root._clearAttentionDismissLink = null;
    if (modal) modal.classList.remove('visible');
  }

  function getConfig(root) {
    var hostEl = (root && root._hostEl) || root;
    const globalConfig = typeof window !== 'undefined' && window.AFTERCARE_CONFIG;
    return {
      apiBase: (hostEl && hostEl.dataset && hostEl.dataset.apiBase) || (globalConfig && globalConfig.apiBase) || DEFAULT_API_BASE,
      // account_api_key refers to the tukios_api_key stored on the accounts table.
      account_api_key: (hostEl && hostEl.dataset && hostEl.dataset.accountApiKey) || (globalConfig && globalConfig.account_api_key) || DEFAULT_ACCOUNT_API_KEY,
      apiKey: (hostEl && hostEl.dataset && hostEl.dataset.apiKey) || (globalConfig && (globalConfig.apiKey || globalConfig.api_key)) || DEFAULT_API_KEY,
      firebaseDbUrl: (globalConfig && globalConfig.firebaseDbUrl) || DEFAULT_FIREBASE_DB_URL,
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

  function apiPatch(config, path, body) {
    if (!config || !config.apiBase) return Promise.reject(new Error('API base URL not configured'));
    var base = config.apiBase.replace(/\/$/, '');
    var pathPart = path.replace(/^\//, '');
    var url = base + '/' + pathPart;
    return fetch(url, {
      method: 'PATCH',
      headers: jsonHeaders(config),
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      if (!res.ok) throw new Error(res.statusText || 'Request failed');
      var ct = res.headers.get('content-type');
      return ct && ct.indexOf('application/json') !== -1 ? res.json() : res.text();
    });
  }

  function parseAccountIdFromUnreadResponse(rawCount) {
    if (rawCount != null && typeof rawCount === 'object') {
      var inner = rawCount.data != null ? rawCount.data : rawCount;
      if (inner && inner.account_id != null) return inner.account_id;
      if (inner && inner.accountId != null) return inner.accountId;
    }
    return null;
  }

  function parseUnreadCountResponse(rawCount) {
    if (typeof rawCount === 'number') return rawCount;
    if (typeof rawCount === 'string' && !isNaN(parseInt(rawCount, 10))) {
      return parseInt(rawCount, 10);
    }
    if (rawCount != null && typeof rawCount === 'object') {
      var inner = rawCount.data != null ? rawCount.data : rawCount;
      if (inner.total_unread != null) return inner.total_unread;
      if (inner.count != null) return inner.count;
      if (inner.unreadCount != null) return inner.unreadCount;
      if (typeof inner === 'number') return inner;
    }
    return 0;
  }

  function markAsRead(config, recipientId) {
    var recipientIdNum = parseInt(recipientId, 10);
    if (isNaN(recipientIdNum)) {
      return Promise.reject(new Error('Invalid recipient id'));
    }
    return apiPatch(config, WIDGET_PATH_PREFIX + '/text-messages/mark-read', {
      recipient_id: recipientIdNum,
    });
  }

  function refreshUnreadBadge(root, config) {
    return apiGet(config, WIDGET_PATH_PREFIX + '/text-messages/unread-count', { days_back: 100000 })
      .then(function (rawCount) {
        updateNavBadge(parseUnreadCountResponse(rawCount));
      })
      .catch(function (err) {
        console.warn('[aftercare-text-widget] unread-count refresh failed:', err);
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
    disconnectInboxSignal();

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
   * Resolve canText from auth product payloads.
   * Supported shapes:
   *   - { success, can_text: 0|1|boolean }
   *   - { success, product: 'ACP' | 'ABT' | 'Dual' }
   *   - { success, products: ['ACP', 'ABT'] }
   */
  function resolveCanTextFromProductResponse(data) {
    if (!data || data.success === false) return null;

    // Newest preferred response shape.
    if (Object.prototype.hasOwnProperty.call(data, 'can_text')) {
      var rawCanText = data.can_text;
      if (typeof rawCanText === 'boolean') return rawCanText;
      if (typeof rawCanText === 'number') return rawCanText === 1;
      if (typeof rawCanText === 'string') {
        var canTextStr = rawCanText.trim().toLowerCase();
        if (canTextStr === '1' || canTextStr === 'true') return true;
        if (canTextStr === '0' || canTextStr === 'false') return false;
      }
    }

    // Backward-compatible product shape.
    var p = data.product;
    if (typeof p === 'string') {
      var normProduct = p.trim().toUpperCase();
      if (normProduct === 'ABT' || normProduct === 'DUAL') return true;
      if (normProduct === 'ACP') return false;
    }

    // Older backward-compatible products list shape.
    var list = data.products;
    if (Array.isArray(list) && list.length > 0) {
      var norm = list.map(function (x) {
        return String(x || '').trim().toUpperCase();
      });
      if (norm.indexOf('ABT') !== -1) return true;
      if (norm.indexOf('ACP') !== -1) return false;
    }

    return null;
  }

  function extractLoginUrl(data) {
    if (!data) return '';
    if (typeof data === 'string') {
      var raw = data.trim();
      if (!raw) return '';
      if (/^https?:\/\//i.test(raw)) return raw;
      try {
        var parsed = JSON.parse(raw);
        return extractLoginUrl(parsed);
      } catch (e) {
        return '';
      }
    }
    return data.loginUrl
      || data.login_url
      || data.url
      || data.redirectUrl
      || data.redirect_url
      || '';
  }

  /**
   * Same POST /api/tukios-auth + redirect as top-bar / ACP-only buttons.
   */
  function wireAftercareAdminButton(root, selector, defaultLabel) {
    var btn = root.querySelector(selector);
    if (!btn) return;
    var originalHtml = btn.innerHTML;
    var fallbackLabel = defaultLabel || btn.textContent || 'Open Aftercare.com';
    function restoreLabel() {
      btn.innerHTML = originalHtml || fallbackLabel;
    }
    btn.addEventListener('click', function () {
      // Open a placeholder tab immediately so browsers don't block it after async auth.
      var newWindow = window.open('about:blank', '_blank');
      if (newWindow && !newWindow.closed) {
        try {
          newWindow.document.title = 'Aftercare login';
          newWindow.document.body.innerHTML = '<div style="font-family:Arial,sans-serif;padding:24px;color:#1a1a2e;">Signing in to Aftercare…</div>';
        } catch (e) {
          // Ignore cross-origin/document access issues.
        }
      }
      var config = getConfig(root);
      if (!config.apiBase || !config.account_api_key) {
        if (newWindow && !newWindow.closed) newWindow.close();
        btn.textContent = 'Configure API + account key';
        setTimeout(function () {
          restoreLabel();
        }, 2500);
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Signing in…';

      apiPost(config, 'tukios-auth', {
        tukios_api_key: String(config.account_api_key),
      })
        .then(function (data) {
          var url = extractLoginUrl(data);
          if (url && typeof url === 'string') {
            var didNavigate = false;
            if (newWindow && !newWindow.closed) {
              try {
                newWindow.location.replace(url);
                didNavigate = true;
              } catch (e) {
                didNavigate = false;
              }
            }
            if (!didNavigate) {
              var fallback = window.open(url, '_blank');
              if (fallback) {
                didNavigate = true;
              }
            }
            if (!didNavigate) {
              window.location.assign(url);
            }
            return;
          }
          if (newWindow && !newWindow.closed) newWindow.close();
          btn.disabled = false;
          btn.textContent = 'Sign-in unavailable';
          setTimeout(function () {
            restoreLabel();
          }, 2500);
        })
        .catch(function () {
          if (newWindow && !newWindow.closed) newWindow.close();
          btn.disabled = false;
          btn.textContent = 'Sign-in failed — try again';
          setTimeout(function () {
            restoreLabel();
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

        // Show one of two startup views based on can_text:
        // can_text=1 => full inbox UI; can_text=0 => non-text interface.
        var canText = resolveCanTextFromProductResponse(data);
        if (canText === false) {
          if (acpOnly) acpOnly.style.display = 'flex';
          wireAftercareAdminButton(root, '#ac-gate-login-btn', 'Open Aftercare.com');
          wireAftercareAdminButton(root, '#ac-gate-login-btn-inline', 'Aftercare.com');
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
    clearScheduleList(root);
  }

  function refreshConversationList(root) {
    return loadConversationList(root, { silent: true });
  }

  function loadConversationList(root, opts) {
    opts = opts || {};
    var silent = !!opts.silent;
    var config = getConfig(root);
    var listEl = root.querySelector('.ac-list-msgs');
    if (!listEl) return Promise.resolve();

    var activeBefore = root.querySelector('.ac-msg.active');
    var activeIdBefore = activeBefore && (activeBefore.dataset.recipientId || activeBefore.dataset.id);

    if (!silent) {
      listEl.innerHTML = '<div class="ac-list-loading" style="padding:24px;text-align:center;color:#8b8fa3;font-size:14px;">Loading conversations…</div>';
    }

    var params = { limit: 50, offset: 0, days_back: 100000 };
    var count_params = { days_back: 100000 };

    return Promise.all([
      apiGet(config, WIDGET_PATH_PREFIX + '/text-messages/conversations', params).catch(function () { return { conversations: [] }; }),
      apiGet(config, WIDGET_PATH_PREFIX + '/text-messages/unread-count', count_params).catch(function () { return { count: 0 }; }),
    ]).then(function (results) {
      var raw = results[0];
      var conversations = (raw.data != null) ? raw.data : ((raw.conversations != null) ? raw.conversations : (Array.isArray(raw) ? raw : []));
      var unreadCount = parseUnreadCountResponse(results[1]);
      var accountId = parseAccountIdFromUnreadResponse(results[1]);
      if (accountId && String(accountId) !== String(root._accountId)) {
        root._accountId = accountId;
        connectInboxSignal(root, accountId);
      }
      renderConversationList(root, listEl, conversations, unreadCount);
      updateNavBadge(unreadCount);
      bindListEvents(root);
      if (activeIdBefore) {
        var restored = root.querySelector('.ac-msg[data-recipient-id="' + activeIdBefore + '"]')
          || root.querySelector('.ac-msg[data-id="' + activeIdBefore + '"]');
        if (restored) restored.classList.add('active');
      }
      if (isCompactViewport()) {
        if (!silent) setMobileView(root, 'list');
      }
      if (!silent) {
        var firstActive = root.querySelector('.ac-msg.active');
        if (firstActive) {
          var rid = firstActive.dataset.recipientId || firstActive.dataset.id;
          if (rid) loadThread(root, rid);
        } else {
          resetConvoPanelForNoSelection(root);
        }
      }
    }).catch(function () {
      if (!silent) {
        listEl.innerHTML = '<div class="ac-list-loading" style="padding:24px;text-align:center;color:#8b8fa3;font-size:14px;">Unable to load conversations. Check data-api-base and network.</div>';
        resetConvoPanelForNoSelection(root);
      }
    });
  }

  function renderConversationList(root, listEl, conversations, unreadCount) {
    var html = '';
    var isFirst = !isCompactViewport();

    conversations.forEach(function (c) {
      html += conversationItemHtml(c, isFirst);
      isFirst = false;
    });

    if (!html) {
      html = '<div style="padding:24px;text-align:center;color:#8b8fa3;font-size:14px;">No conversations yet.</div>';
    }

    listEl.innerHTML = html;
  }

  function conversationItemHtml(c, isFirst) {
    var id = c.recipient_id != null ? String(c.recipient_id) : (c.recipientId != null ? String(c.recipientId) : (c.id != null ? String(c.id) : ''));
    var locationName = c.location_name
      || c.locationName
      || c.location
      || (c.location_info && (c.location_info.name || c.location_info.location_name))
      || (c.locationInfo && (c.locationInfo.name || c.locationInfo.locationName))
      || (c.funeral_home && (c.funeral_home.name || c.funeral_home.location_name))
      || (c.funeralHome && (c.funeralHome.name || c.funeralHome.locationName))
      || 'Location';
    var name = (c.recipient_first_name != null || c.recipient_last_name != null)
      ? ((c.recipient_first_name || '') + ' ' + (c.recipient_last_name || '')).trim() || 'Unknown'
      : ((c.recipient && (c.recipient.name || c.recipient.displayName)) || 'Unknown');
    var last = c.last_message || c.lastMessage || {};
    var preview = (last.text_message != null ? last.text_message : (last.body != null ? last.body : (last.preview != null ? last.preview : (last.text != null ? last.text : ''))));
    var rawAt = last.entry_date != null ? last.entry_date : (c.last_message_date != null ? c.last_message_date : (last.createdAt != null ? last.createdAt : (last.sentAt != null ? last.sentAt : (last.at != null ? last.at : last.date))));
    var dateStr = formatDate(rawAt);
    var activeClass = isFirst ? ' active' : '';
    var needsAttention = conversationNeedsAttention(c);
    var indicator = needsAttention
      ? '<div class="ac-msg-ind"><span class="ac-alert-dot" aria-hidden="true"></span></div>'
      : '<div class="ac-msg-ind"></div>';
    var dismiss = needsAttention
      ? '<div class="ac-attention-row"><span class="ac-attention-label">AI Flagged</span><div class="ac-dismiss" data-resolve="' + escapeAttr(id) + '">Clear</div></div>'
      : '';
    return '<div class="ac-msg' + activeClass + '" data-id="' + escapeAttr(id) + '" data-recipient-id="' + escapeAttr(id) + '" data-needs-attention="' + (needsAttention ? '1' : '0') + '">' +
      indicator +
      '<div class="ac-msg-body">' +
      '<div class="ac-msg-top"><span class="ac-msg-loc">' + escapeHtml(locationName) + '</span><span class="ac-msg-date">' + escapeHtml(dateStr) + '</span></div>' +
      '<div class="ac-msg-recipient">' + escapeHtml(name) + '</div>' +
      '<div class="ac-msg-preview">' + escapeHtml(preview || '') + '</div>' +
      dismiss + '</div></div>';
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  var MESSAGE_URL_RE = /(?:https?:\/\/|www\.)[^\s<]+/gi;

  function trimUrlTrailingPunctuation(url) {
    return url.replace(/[.,;:!?)}\]'"]+$/, '');
  }

  function linkifyMessageText(text) {
    if (text == null || text === '') return '';
    var str = decodeHtmlEntities(String(text));
    var result = '';
    var lastIndex = 0;
    var match;
    MESSAGE_URL_RE.lastIndex = 0;
    while ((match = MESSAGE_URL_RE.exec(str)) !== null) {
      var raw = match[0];
      var url = trimUrlTrailingPunctuation(raw);
      var trail = raw.slice(url.length);
      result += escapeHtml(str.slice(lastIndex, match.index));
      var href = /^www\./i.test(url) ? 'https://' + url : url;
      result += '<a class="ac-msg-link" href="' + escapeAttr(href) + '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(url) + '</a>' + escapeHtml(trail);
      lastIndex = match.index + raw.length;
    }
    result += escapeHtml(str.slice(lastIndex));
    return result;
  }

  function escapeAttr(s) {
    if (s == null) return '';
    return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function decodeHtmlEntities(s) {
    if (s == null) return '';
    var text = String(s);
    if (text.indexOf('&') === -1) return text;
    var textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
  }

  function parseDisplayDate(raw) {
    return parseWallClockDate(raw);
  }

  function formatDate(raw) {
    if (!raw) return '';
    var d = parseWallClockDate(raw);
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
      if (el.dataset.boundOpenThread === '1') return;
      el.dataset.boundOpenThread = '1';
      el.addEventListener('click', function () {
        root.querySelectorAll('.ac-msg').forEach(function (m) { m.classList.remove('active'); });
        el.classList.add('active');
        var recipientId = el.dataset.recipientId || el.dataset.id;
        if (recipientId) {
          loadThread(root, recipientId);
          if (isCompactViewport()) {
            setMobileView(root, 'thread');
          }
        }
      });
    });
    root.querySelectorAll('.ac-dismiss').forEach(function (link) {
      bindDismissLink(root, link);
    });
  }

  function clearAttentionByRecipient(root, recipientId, dismissLink) {
    var config = getConfig(root);
    if (!config.apiBase) {
      return Promise.reject(new Error('API base URL not configured'));
    }
    var recipientIdNum = parseInt(recipientId, 10);
    if (isNaN(recipientIdNum)) {
      return Promise.reject(new Error('Invalid recipient id'));
    }
    return fetch((config.apiBase.replace(/\/$/, '')) + '/' + WIDGET_PATH_PREFIX + '/text-messages/clear-attention', {
      method: 'PATCH',
      headers: jsonHeaders(config),
      body: JSON.stringify({ recipient_id: recipientIdNum }),
    }).then(function (res) {
      if (!res.ok) {
        throw new Error('Failed to clear attention');
      }
      clearMessageAttention(root, dismissLink, recipientId);
    });
  }
  function clearMessageAttention(root, dismissLink, recipientId) {
    var msg = dismissLink && dismissLink.closest('.ac-msg');
    if (!msg && recipientId) {
      msg = root.querySelector('.ac-msg[data-recipient-id="' + recipientId + '"]')
        || root.querySelector('.ac-msg[data-id="' + recipientId + '"]');
    }
    if (!msg) return;
    msg.dataset.needsAttention = '0';
    var indicator = msg.querySelector('.ac-msg-ind');
    if (indicator) indicator.innerHTML = '';
    var attentionRow = msg.querySelector('.ac-attention-row');
    if (attentionRow) attentionRow.remove();

    var activeRecipientId = (root.querySelector('.ac-msg.active') && (root.querySelector('.ac-msg.active').dataset.recipientId || root.querySelector('.ac-msg.active').dataset.id)) || '';
    var resolvedRecipientId = recipientId || (msg.dataset.recipientId || msg.dataset.id || '');
    if (activeRecipientId && resolvedRecipientId && String(activeRecipientId) === String(resolvedRecipientId)) {
      var msgsEl = root.querySelector('.ac-msgs');
      if (msgsEl) msgsEl.dataset.recipientNeedsAttention = '0';
      root.querySelectorAll('.ac-bubble.in').forEach(function (bubble) {
        bubble.dataset.needsAttention = '0';
        bubble.classList.remove('flagged');
      });
    }
    updateAttentionCount(root);
  }

  function updateAttentionCount(root) {
    rebuildConversationSections(root);
  }

  function refreshThread(root, recipientId) {
    var config = getConfig(root);
    if (!config.apiBase || !recipientId) return Promise.resolve();

    var active = root.querySelector('.ac-msg.active');
    var activeId = active && (active.dataset.recipientId || active.dataset.id);
    if (String(activeId) !== String(recipientId)) return Promise.resolve();

    return apiGet(config, WIDGET_PATH_PREFIX + '/text-messages/thread/' + encodeURIComponent(recipientId), { order: 'asc' })
      .then(function (data) {
        var stillActive = root.querySelector('.ac-msg.active');
        var stillId = stillActive && (stillActive.dataset.recipientId || stillActive.dataset.id);
        if (String(stillId) !== String(recipientId)) return;
        renderThread(root, data, recipientId);
      })
      .catch(function (err) {
        console.warn('[aftercare-text-widget] thread refresh failed:', err);
      });
  }

  function loadThread(root, recipientId) {
    var config = getConfig(root);
    if (!config.apiBase) return;

    root._scheduleLoadId = (root._scheduleLoadId || 0) + 1;
    var loadId = root._scheduleLoadId;

    var msgsEl = root.querySelector('.ac-msgs');
    if (msgsEl) {
      msgsEl.innerHTML = '<div class="ac-sys">Loading messages…</div>';
    }

    apiGet(config, WIDGET_PATH_PREFIX + '/text-messages/thread/' + encodeURIComponent(recipientId), { order: 'asc' })
      .then(function (data) {
        if (loadId !== root._scheduleLoadId) return;
        renderThread(root, data, recipientId);

        var inner = data.data || data;
        var threadUnread = inner.unread_count != null ? inner.unread_count : (inner.unreadCount != null ? inner.unreadCount : 0);
        if (threadUnread > 0) {
          markAsRead(config, recipientId)
            .then(function () {
              if (loadId !== root._scheduleLoadId) return;
              refreshUnreadBadge(root, config);
            })
            .catch(function (err) {
              console.warn('[aftercare-text-widget] mark-read failed:', err);
            });
        }
      })
      .catch(function () {
        if (loadId !== root._scheduleLoadId) return;
        if (msgsEl) {
          msgsEl.innerHTML = '<div class="ac-sys">Unable to load messages.</div>';
        }
      });
  }

  function renderThread(root, data, recipientId) {
    var inner = data.data || data;
    var messages = inner.messages || [];
    var recipient = inner.recipient || {};
    var recipientAttentionActive = threadRecipientNeedsAttention(inner, recipient);
    var family = recipient.family || {};

    var firstName = recipient.first_name || recipient.firstName || '';
    var lastName = recipient.last_name || recipient.lastName || '';
    var name = ((firstName + ' ' + lastName).trim()) || 'Unknown';
    var phone = recipient.phone_number || recipient.phoneNumber || recipient.phone || '';

    var decedentName = family.decedent_name || family.decedentName || '';
    var dateOd = family.date_od || family.dateOd || '';
    var dateOdStr = '';
    if (dateOd) {
      var formattedDod = formatCalendarDate(dateOd);
      if (formattedDod) dateOdStr = 'd. ' + formattedDod;
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
    msgsEl.dataset.recipientNeedsAttention = recipientAttentionActive ? '1' : '0';
    var html = '';
    var lastAttentionIndex = -1;
    messages.forEach(function (msg, index) {
      var msgTypeForAttention = msg.message_type || msg.messageType || '';
      if (msgTypeForAttention === 'outgoing' || msgTypeForAttention === 'outgoing_campaign') return;
      var hasModForAttention = msg.moderation && msg.moderation.length > 0;
      var flaggedByStatusForAttention = messageNeedsAttention(msg);
      var flaggedByLegacyForAttention = !msg.moderated && !msg.admin_viewed && hasModForAttention;
      if (flaggedByStatusForAttention || flaggedByLegacyForAttention) lastAttentionIndex = index;
    });

    messages.forEach(function (msg, index) {
      var msgType = msg.message_type || msg.messageType || '';
      if (msgType === 'admin-note' || msgType === 'admin_note') {
        html += '<div class="ac-flag">✦ ' + linkifyMessageText(msg.text_message || msg.textMessage || '') + '</div>';
        return;
      }
      var dir = (msgType === 'outgoing' || msgType === 'outgoing_campaign') ? 'out' : 'in';
      var body = msg.text_message != null ? msg.text_message : (msg.textMessage != null ? msg.textMessage : (msg.body != null ? msg.body : ''));
      var rawDate = extractMessageTimestamp(msg);
      var meta = formatMessageMeta(rawDate);

      var hasMod = msg.moderation && msg.moderation.length > 0;
      var flaggedByStatus = messageNeedsAttention(msg);
      var flaggedByLegacy = !msg.moderated && !msg.admin_viewed && hasMod;
      var hasAttention = (msgType === 'incoming' && (flaggedByStatus || flaggedByLegacy));
      var isLastAttention = recipientAttentionActive && hasAttention && index === lastAttentionIndex;
      var flagged = isLastAttention ? ' flagged' : '';

      var messageId = extractMessageId(msg);
      var idAttr = messageId ? ' data-message-id="' + escapeAttr(messageId) + '"' : '';
      var image = extractMessageImage(msg) || '';
      var reaction = extractMessageReaction(msg);
      var mediaOnly = !body && !!image;
      var bubbleClass = 'ac-bubble ' + dir + flagged + (mediaOnly ? ' media-only' : '');
      var imgHtml = image
        ? '<div class="ac-image-wrap"><img class="ac-msg-image" src="' + escapeAttr(image) + '" /></div>'
        : '';
      var reactionHtml = reaction ? '<div class="ac-reaction-badge">' + escapeHtml(reaction) + '</div>' : '';
      html += '<div class="' + bubbleClass + '"' + idAttr +
        ' data-message-body="' + escapeAttr(body) + '"' +
        ' data-message-meta="' + escapeAttr(meta) + '"' +
        ' data-message-image="' + escapeAttr(image) + '"' +
        ' data-needs-attention="' + (hasAttention ? '1' : '0') + '"' +
        ' data-message-reaction="' + escapeAttr(reaction) + '">' +
        reactionHtml + linkifyMessageText(body) + imgHtml + '<div class="ac-meta">' + escapeHtml(meta) + '</div></div>';
    });
    msgsEl.innerHTML = html || '<div class="ac-sys">No messages in this thread.</div>';
    ensureOnlyLastFlaggedMessage(msgsEl);
    scrollMessagesToBottom(msgsEl);

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
      loadSchedule(root, familyId);
    } else {
      clearScheduleList(root);
    }
  }

  function clearScheduleList(root) {
    var listEl = root.querySelector('#ac-schedule-list');
    if (listEl) {
      listEl.innerHTML = '<div style="font-size:12px;color:#8b8fa3;padding:8px 0;">No scheduled messages.</div>';
    }
    root._scheduleItems = {};
  }

  function loadSchedule(root, familyId) {
    var config = getConfig(root);
    if (!config.apiBase) return;

    root._scheduleLoadId = (root._scheduleLoadId || 0) + 1;
    var loadId = root._scheduleLoadId;

    var listEl = root.querySelector('#ac-schedule-list');
    if (listEl) {
      listEl.innerHTML = '<div style="font-size:12px;color:#8b8fa3;padding:8px 0;">Loading schedule…</div>';
    }

    apiGet(config, WIDGET_PATH_PREFIX + '/aftercare-families/' + encodeURIComponent(familyId) + '/schedule', { type: 'text' })
      .then(function (res) {
        if (loadId !== root._scheduleLoadId) return;
        var items = res.data || res || [];
        renderSchedule(root, items);
      })
      .catch(function () {
        if (loadId !== root._scheduleLoadId) return;
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

      var label = decodeHtmlEntities(item.description || item.desc || '');
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
        var label = decodeHtmlEntities(item.description || item.desc || '');
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
        root.querySelector('#ac-modal-msg').textContent = decodeHtmlEntities(message);

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
    var sendBtnLabel = sendBtn ? sendBtn.querySelector('.ac-send-label') : null;
    if (sendBtn) {
      sendBtn.disabled = true;
      if (sendBtnLabel) sendBtnLabel.textContent = 'Sending...';
    }

    var msgsEl = root.querySelector('.ac-msgs');
    if (msgsEl) {
      var meta = formatMessageMeta(wallClockNowEastern());
      var bubble = document.createElement('div');
      bubble.className = 'ac-bubble out';
      setBubbleContent(bubble, message, meta, imageUrl, '');
      bubble.dataset.optimistic = 'true';
      msgsEl.appendChild(bubble);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    input.value = '';
    clearStagedImage(root);

    var body = { message: message };
    if (imageUrl) body.image = imageUrl;

    apiPost(config, WIDGET_PATH_PREFIX + '/text-messages/thread/' + encodeURIComponent(recipientId), body)
      .then(function (result) {
        if (sendBtn) {
          sendBtn.disabled = false;
          if (sendBtnLabel) sendBtnLabel.textContent = 'Send';
        }
        var payload = result && result.data != null ? result.data : result;
        var sentAt = payload && (payload.sent_at != null ? payload.sent_at : payload.sentAt);
        var threadId = payload && (payload.thread_id != null ? payload.thread_id : payload.threadId);
        if (msgsEl) {
          var optimistic = msgsEl.querySelector('.ac-bubble.out[data-optimistic]');
          if (optimistic) {
            if (sentAt) {
              var confirmedMeta = formatMessageMeta(sentAt);
              var confirmedBody = optimistic.dataset.messageBody || message;
              var confirmedImage = optimistic.dataset.messageImage || imageUrl || '';
              setBubbleContent(optimistic, confirmedBody, confirmedMeta, confirmedImage, '');
              optimistic.removeAttribute('data-optimistic');
              if (threadId != null) optimistic.dataset.messageId = String(threadId);
            } else {
              refreshThread(root, recipientId);
            }
          }
        }
        refreshConversationList(root);
      })
      .catch(function () {
        if (sendBtn) {
          sendBtn.disabled = false;
          if (sendBtnLabel) sendBtnLabel.textContent = 'Send';
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
${S} .ac-topbar-settings { display: inline-flex; align-items: center; gap: 6px; font-family: inherit; font-size: 13px; font-weight: 600; color: #02a473; cursor: pointer; padding: 6px 14px; border: 1px solid #c8ece0; border-radius: 6px; background: #f0faf6; transition: all 0.15s; }
${S} .ac-topbar-settings:hover:not(:disabled) { background: #e0f5ed; border-color: #02a473; }
${S} .ac-topbar-settings:disabled { opacity: 0.65; cursor: not-allowed; }
${S} .ac-topbar-settings svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

/* Product gate (ACP-only accounts: no text inbox) */
${S} .ac-product-gate { flex: 1; display: flex; flex-direction: column; background: #fff; min-height: 180px; }
${S} .ac-gate-loading { flex: 1; display: flex; align-items: center; justify-content: center; font-size: 15px; color: #8b8fa3; }
${S} .ac-gate-acp-only { display: flex; flex-direction: column; height: 100%; }
${S} .ac-gate-topbar { display: flex; align-items: center; justify-content: space-between; padding: 14px 24px; background: #fff; border-bottom: 1px solid #e2e6ec; flex-shrink: 0; }
${S} .ac-gate-title { font-size: 20px; font-weight: 800; color: #1a1a2e; }
${S} .ac-topbar-link { display: inline-flex; align-items: center; gap: 6px; font-family: inherit; font-size: 13px; font-weight: 600; color: #02a473; text-decoration: none; padding: 6px 14px; border: 1px solid #c8ece0; border-radius: 6px; background: #f0faf6; transition: all 0.15s; cursor: pointer; }
${S} .ac-topbar-link:hover:not(:disabled) { background: #e0f5ed; border-color: #02a473; }
${S} .ac-topbar-link:disabled { opacity: 0.65; cursor: not-allowed; }
${S} .ac-topbar-link svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
${S} .ac-card-only-content { padding: 32px 36px; max-width: 620px; }
${S} .ac-card-status { font-size: 16px; font-weight: 600; color: #1a1a2e; margin: 0 0 28px; line-height: 1.5; }
${S} .ac-card-actions { display: flex; flex-direction: column; gap: 24px; }
${S} .ac-card-action { display: flex; align-items: flex-start; gap: 14px; }
${S} .ac-card-action-icon { width: 38px; height: 38px; border-radius: 9px; background: #f0faf6; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
${S} .ac-card-action-icon svg { width: 18px; height: 18px; stroke: #02a473; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
${S} .ac-card-action-body { display: flex; flex-direction: column; }
${S} .ac-card-action-text { font-size: 15px; color: #4a4d52; line-height: 1.6; }
${S} .ac-card-screenshot { margin-top: 12px; border-radius: 6px; border: 1px solid #e2e6ec; max-width: 100%; height: auto; display: block; background: #f8fafc; }
${S} .ac-card-inline-btn { margin-top: 10px; width: fit-content; }
${S} .ac-card-link-muted { color: #1a1a2e; font-weight: 600; text-decoration: none; }
${S} .ac-card-link-muted:hover { text-decoration: underline; }
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
${S} .ac-alert-dot { display: block; width: 8px; height: 8px; border-radius: 50%; background: #e74c3c; margin-top: 4px; }
${S} .ac-msg-body { flex: 1; min-width: 0; }
${S} .ac-msg-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px; }
${S} .ac-msg-loc { font-size: 11px; font-weight: 700; color: #8b8fa3; text-transform: uppercase; letter-spacing: 0.35px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
${S} .ac-msg-date { font-size: 12px; color: #8b8fa3; white-space: nowrap; }
${S} .ac-msg-recipient { font-weight: 600; font-size: 14px; color: #1a1a2e; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${S} .ac-msg-preview { font-size: 13px; color: #5a5d72; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${S} .ac-attention-row { margin-top: 4px; display: flex; align-items: center; gap: 12px; font-size: 11px; }
${S} .ac-attention-label { color: #b1b7c8; font-weight: 600; }
${S} .ac-dismiss { color: #b1b7c8; cursor: pointer; transition: color 0.15s; }
${S} .ac-dismiss:hover { color: #4a6cf7; }

/* Conversation */
${S} .ac-convo { flex: 1; display: flex; flex-direction: column; background: #f8f9fb; }
${S} .ac-convo-hdr { padding: 14px 24px; background: #fff; border-bottom: 1px solid #e2e6ec; display: flex; align-items: center; gap: 16px; }
${S} .ac-mobile-back { display: none; width: 30px; height: 30px; border: 1px solid #dde1e8; border-radius: 8px; background: #fff; color: #5a5d72; cursor: pointer; font-size: 18px; line-height: 1; align-items: center; justify-content: center; font-family: inherit; }
${S} .ac-convo-name { font-size: 15px; font-weight: 600; color: #1a1a2e; }
${S} .ac-convo-phone { font-size: 12px; color: #8b8fa3; margin-top: 1px; }
${S} .ac-convo-sep { width: 1px; height: 32px; background: #e2e6ec; }
${S} .ac-convo-dec { font-size: 14px; font-weight: 500; color: #5a5d72; }
${S} .ac-convo-ddate { font-size: 12px; color: #8b8fa3; margin-top: 1px; }
${S} .ac-msgs { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 24px; display: flex; flex-direction: column; gap: 12px; }
${S} .ac-sys { align-self: center; font-size: 11px; color: #8b8fa3; font-weight: 500; }
${S} .ac-bubble { max-width: 75%; padding: 12px 16px; border-radius: 12px; font-size: 14px; line-height: 1.5; position: relative; overflow: visible; }
${S} .ac-bubble.out { align-self: flex-end; background: #4a6cf7; color: #fff; border-bottom-right-radius: 4px; }
${S} .ac-bubble.out.media-only { background: transparent; color: #1a1a2e; padding: 0; border-radius: 0; }
${S} .ac-bubble.in { align-self: flex-start; background: #fff; color: #1a1a2e; border: 1px solid #e2e6ec; border-bottom-left-radius: 4px; }
${S} .ac-bubble.in.media-only { background: transparent; color: #1a1a2e; padding: 0; border-radius: 0; border: 0; }
${S} .ac-bubble.in.flagged { border-color: #e74c3c; border-width: 2px; box-shadow: 0 0 0 1px rgba(231,76,60,0.12); }
${S} .ac-image-wrap { margin-top: 8px; }
${S} .ac-msg-image { max-width: 200px; max-height: 220px; border-radius: 8px; display: block; }
${S} .ac-bubble.media-only .ac-image-wrap { margin-top: 0; }
${S} .ac-reaction-badge { position: absolute; top: -10px; left: -10px; min-width: 26px; height: 22px; padding: 0 7px; border-radius: 999px; background: #fff; border: 1px solid #dde1e8; box-shadow: 0 2px 6px rgba(0,0,0,0.12); display: inline-flex; align-items: center; justify-content: center; font-size: 13px; line-height: 1; }
${S} .ac-msg-link { text-decoration: underline; word-break: break-all; }
${S} .ac-bubble.in .ac-msg-link { color: #4a6cf7; }
${S} .ac-bubble.out .ac-msg-link { color: #fff; }
${S} .ac-flag .ac-msg-link { color: #92400e; }
${S} .ac-meta { font-size: 11px; opacity: 0.6; margin-top: 4px; }
${S} .ac-bubble.out .ac-meta { text-align: right; }
${S} .ac-bubble.out.media-only .ac-meta { color: #8b8fa3; opacity: 1; text-align: left; margin-top: 6px; }
${S} .ac-flag { font-size: 12px; color: #92400e; font-weight: 500; padding: 4px 0; align-self: flex-start; }
${S} .ac-flag-notif { color: #b0956a; font-weight: 400; }

/* Reply bar */
${S} .ac-reply { padding: 16px 24px; background: #fff; border-top: 1px solid #e2e6ec; display: flex; gap: 10px; align-items: center; }
${S} .ac-reply-wrap { flex: 1; display: flex; flex-direction: column; gap: 6px; }
${S} .ac-reply-input-row { position: relative; display: flex; align-items: center; gap: 8px; }
${S} .ac-reply-input-row input[type=text] { width: 100%; padding: 10px 14px; border: 1px solid #dde1e8; border-radius: 10px; font-size: 14px; font-family: inherit; background: #f8f9fb; outline: none; }
${S} .ac-reply-input-row input[type=text]:focus { border-color: #4a6cf7; }
${S} .ac-reply-icons { display: flex; gap: 8px; }
${S} .ac-img-chip { display: flex; align-items: center; gap: 8px; background: #f0f3ff; border: 1px solid #c5d0fb; border-radius: 8px; padding: 6px 10px; }
${S} .ac-img-thumb { height: 40px; width: 40px; object-fit: cover; border-radius: 4px; border: 1px solid #dde1e8; }
${S} .ac-img-chip-label { font-size: 12px; color: #4a6cf7; font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${S} .ac-img-chip-rm { background: none; border: none; cursor: pointer; color: #5a5d72; font-size: 14px; line-height: 1; padding: 2px 4px; border-radius: 4px; font-family: inherit; }
${S} .ac-img-chip-rm:hover { background: #e0e5ff; color: #e74c3c; }
${S} .ac-img-uploading { font-size: 12px; color: #8b8fa3; padding: 4px 0; }
${S} .ac-reply-ibtn { width: 40px; height: 40px; border: 1px solid #dde1e8; background: #fff; color: #98a2b3; cursor: pointer; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; transition: all 0.15s; }
${S} .ac-reply-ibtn svg { width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
${S} .ac-reply-ibtn:hover { color: #6b7280; border-color: #c9ced8; background: #f9fafb; }
${S} .ac-send-btn { height: 44px; padding: 0 20px; background: #c1c7d0; color: #fff; border: none; border-radius: 10px; font-size: 24px; font-weight: 600; cursor: pointer; font-family: inherit; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-width: 98px; }
${S} .ac-send-btn svg { width: 16px; height: 16px; stroke: currentColor; fill: currentColor; stroke-width: 1.5; }
${S} .ac-send-btn .ac-send-label { font-size: 15px; font-weight: 600; line-height: 1; }
${S} .ac-send-btn:hover { background: #b5bcc7; }
${S} .ac-send-btn:disabled { opacity: 0.7; cursor: not-allowed; }
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

/* Clear attention confirm modal */
${S} .ac-clear-confirm { width: 420px; max-width: 90vw; background: #fff; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.2); overflow: hidden; animation: acModalIn 0.2s ease; padding: 14px 16px 16px; }
${S} .ac-clear-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
${S} .ac-clear-title { font-size: 22px; line-height: 1.15; font-weight: 700; color: #1b2340; }
${S} .ac-clear-close { width: 28px; height: 28px; border-radius: 6px; border: none; background: transparent; color: #9aabc5; font-size: 22px; line-height: 1; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
${S} .ac-clear-copy { font-size: 15px; line-height: 1.4; color: #1b2340; margin-bottom: 12px; }
${S} .ac-clear-actions { display: flex; gap: 10px; }
${S} .ac-clear-actions button { flex: 1; height: 44px; border-radius: 8px; border: none; font-size: 16px; font-weight: 600; font-family: inherit; cursor: pointer; }
${S} .ac-clear-cancel { background: #dbe0e7; color: #0f1f3b; }
${S} .ac-clear-confirm-btn { background: #0f6d4b; color: #fff; }

/* Compact/mobile behavior */
@media (max-width: 820px) {
${S}.ac-mobile .ac-inbox { flex: 1; min-height: 0; }
${S}.ac-mobile .ac-list { width: 100%; min-width: 0; border-right: none; }
${S}.ac-mobile .ac-convo { width: 100%; }
${S}.ac-mobile .ac-detail { display: none; }
${S}.ac-mobile.ac-mobile-list .ac-list { display: flex; }
${S}.ac-mobile.ac-mobile-list .ac-convo { display: none; }
${S}.ac-mobile.ac-mobile-thread .ac-list { display: none; }
${S}.ac-mobile.ac-mobile-thread .ac-convo { display: flex; }
${S}.ac-mobile .ac-mobile-back { display: inline-flex; }
${S}.ac-mobile .ac-convo-hdr { padding: 10px 12px; gap: 10px; }
${S}.ac-mobile .ac-msgs { padding: 14px; }
${S}.ac-mobile .ac-reply { padding: 10px 12px; }
}
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
    <div class="ac-gate-topbar">
      <div class="ac-gate-title">Aftercare Card Program</div>
      <button type="button" class="ac-topbar-link" id="ac-gate-login-btn">
        Manage your account on Aftercare.com
        <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </button>
    </div>
    <div class="ac-card-only-content">
      <p class="ac-card-status">Your funeral home is enrolled in the Aftercare Card Program.</p>
      <div class="ac-card-actions">
        <div class="ac-card-action">
          <div class="ac-card-action-icon">
            <svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"></rect><polyline points="22,7 12,14 2,7"></polyline></svg>
          </div>
          <div class="ac-card-action-body">
            <span class="ac-card-action-text">To enroll a family to receive cards, you'll see the option under "Next Steps" when you publish an obituary.</span>
            <img class="ac-card-screenshot" alt="Next Steps screenshot" src="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='280' viewBox='0 0 900 280'%3E%3Crect width='900' height='280' fill='%23f8fafc'/%3E%3Crect x='22' y='20' width='856' height='240' rx='10' fill='%23ffffff' stroke='%23e2e6ec'/%3E%3Crect x='44' y='44' width='300' height='24' rx='4' fill='%23e5e7eb'/%3E%3Crect x='44' y='84' width='812' height='14' rx='4' fill='%23eef2f7'/%3E%3Crect x='44' y='108' width='782' height='14' rx='4' fill='%23eef2f7'/%3E%3Crect x='44' y='132' width='816' height='14' rx='4' fill='%23eef2f7'/%3E%3Crect x='44' y='168' width='170' height='34' rx='6' fill='%2302a473'/%3E%3Crect x='44' y='214' width='240' height='12' rx='4' fill='%23dbe3ee'/%3E%3C/svg%3E" />
          </div>
        </div>
        <div class="ac-card-action">
          <div class="ac-card-action-icon">
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
          </div>
          <div class="ac-card-action-body">
            <span class="ac-card-action-text">To view enrolled families or download completed surveys, go to your account at Aftercare.com.</span>
            <button type="button" class="ac-topbar-link ac-card-inline-btn" id="ac-gate-login-btn-inline">
              Aftercare.com
              <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </button>
          </div>
        </div>
        <div class="ac-card-action">
          <div class="ac-card-action-icon">
            <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
          </div>
          <span class="ac-card-action-text">If you need help or have questions about your program, call <a href="tel:18007217097" class="ac-card-link-muted">1-800-721-7097</a> or email <a href="mailto:support@aftercare.com" class="ac-card-link-muted">support@aftercare.com</a>.</span>
        </div>
      </div>
    </div>
  </div>
</div>
<div id="ac-text-ui" class="ac-text-ui" style="display:none">
<!-- Aftercare top bar -->
<div class="ac-topbar">
  <div class="ac-topbar-left">Aftercare Text</div>
  <button type="button" class="ac-topbar-link" id="ac-open-admin-btn">
    Open Aftercare.com
    <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
  </button>
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
      <button type="button" class="ac-mobile-back" id="ac-mobile-back-btn" title="Back to recipients" aria-label="Back to recipients">←</button>
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
            <button type="button" class="ac-reply-ibtn ac-emoji-btn" title="Emoji" aria-label="Emoji">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9"></circle>
                <circle cx="9" cy="10" r="1"></circle>
                <circle cx="15" cy="10" r="1"></circle>
                <path d="M8 14c1 1.5 2.3 2.2 4 2.2s3-.7 4-2.2"></path>
              </svg>
            </button>
            <button type="button" class="ac-reply-ibtn ac-img-btn" title="Attach image" aria-label="Attach image">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2"></rect>
                <circle cx="9" cy="10" r="1.6"></circle>
                <path d="M4.5 17l5.2-5.2a1 1 0 0 1 1.4 0L14 14.7a1 1 0 0 0 1.4 0l2.8-2.8a1 1 0 0 1 1.4 0L21 13.3"></path>
              </svg>
            </button>
          </div>
          <div class="ac-emoji-panel" id="ac-emoji-panel"></div>
        </div>
      </div>
      <button class="ac-send-btn">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 11.5l17-8.5-4.8 18-4.1-6.2-8.1-3.3z"></path>
        </svg>
        <span class="ac-send-label">Send</span>
      </button>
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

<!-- Clear Attention Confirm Modal -->
<div class="ac-modal-bg" id="ac-clear-attn-modal">
  <div class="ac-clear-confirm">
    <div class="ac-clear-top">
      <h3 class="ac-clear-title">Mark as Resolved?</h3>
      <button class="ac-clear-close" id="ac-clear-attn-close" aria-label="Close">×</button>
    </div>
    <p class="ac-clear-copy">Are you sure you want to mark this conversation as resolved? It will be removed from the "Needs Attention" list.</p>
    <div class="ac-clear-actions">
      <button class="ac-clear-cancel" id="ac-clear-attn-cancel">Cancel</button>
      <button class="ac-clear-confirm-btn" id="ac-clear-attn-confirm">Yes, resolve</button>
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
    initResponsiveBehavior(root);
    var mobileBackBtn = root.querySelector('#ac-mobile-back-btn');
    if (mobileBackBtn) {
      mobileBackBtn.addEventListener('click', function () {
        setMobileView(root, 'list');
      });
    }
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

    // Clear attention confirm modal
    var clearModal = root.querySelector('#ac-clear-attn-modal');
    var clearClose = root.querySelector('#ac-clear-attn-close');
    var clearCancel = root.querySelector('#ac-clear-attn-cancel');
    var clearConfirm = root.querySelector('#ac-clear-attn-confirm');
    if (clearClose) {
      clearClose.addEventListener('click', function () {
        closeClearAttentionConfirm(root);
      });
    }
    if (clearCancel) {
      clearCancel.addEventListener('click', function () {
        closeClearAttentionConfirm(root);
      });
    }
    if (clearModal) {
      clearModal.addEventListener('click', function (e) {
        if (e.target === clearModal) closeClearAttentionConfirm(root);
      });
    }
    if (clearConfirm) {
      clearConfirm.addEventListener('click', function () {
        var recipientId = clearConfirm.dataset.recipientId || '';
        if (!recipientId) {
          closeClearAttentionConfirm(root);
          return;
        }
        var dismissLink = root._clearAttentionDismissLink || null;
        var cancelBtn = root.querySelector('#ac-clear-attn-cancel');
        clearConfirm.disabled = true;
        clearConfirm.textContent = 'Resolving...';
        if (cancelBtn) cancelBtn.disabled = true;
        clearAttentionByRecipient(root, recipientId, dismissLink)
          .then(function () {
            closeClearAttentionConfirm(root);
          })
          .catch(function () {
            clearConfirm.disabled = false;
            clearConfirm.textContent = 'Try again';
            if (cancelBtn) cancelBtn.disabled = false;
          });
      });
    }

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
