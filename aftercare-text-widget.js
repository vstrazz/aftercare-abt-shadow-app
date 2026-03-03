/**
 * Aftercare Text Widget
 * =====================
 * Self-contained script that renders the Aftercare Text inbox
 * inside any host application (e.g., Tukios admin).
 *
 * USAGE:
 *   1. Host page includes a div with id="aftercare-text-root"
 *      Optional: data-api-base="https://your-api.com/api" data-account-id="2715"
 *   2. Or set window.AFTERCARE_CONFIG = { apiBase: '...', accountId: 2715 } before loading the script
 *   3. Host page loads this script: <script src="https://aftercare.com/widget/aftercare-text.js" defer></script>
 *   4. Script fetches conversations from the API and renders the message list
 *
 * OPTIONAL:
 *   - If the host page has an element with id="aftercare-text-nav-badge",
 *     the script will update it with the current attention count.
 */
(function () {
  'use strict';

  const DEFAULT_ACCOUNT_ID = '2715';

  function getConfig(root) {
    const globalConfig = typeof window !== 'undefined' && window.AFTERCARE_CONFIG;
    return {
      apiBase: (root && root.dataset.apiBase) || (globalConfig && globalConfig.apiBase) || '',
      accountId: (root && root.dataset.accountId) || (globalConfig && globalConfig.accountId) || DEFAULT_ACCOUNT_ID,
    };
  }

  function apiGet(apiBase, path, params) {
    if (!apiBase) return Promise.reject(new Error('API base URL not configured'));
    var base = apiBase.replace(/\/$/, '');
    var search = new URLSearchParams(params || {});
    var pathPart = path.replace(/^\//, '');
    var url = pathPart.indexOf('?') !== -1
      ? base + '/' + pathPart + '&' + search.toString()
      : base + '/' + pathPart + (search.toString() ? '?' + search.toString() : '');
    return fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error(res.statusText || 'Request failed');
        const ct = res.headers.get('content-type');
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

  function render(root) {
    if (root.dataset.aftercareInit) return; // Already initialized
    root.dataset.aftercareInit = 'true';

    // Load font
    if (!document.querySelector('link[href*="DM+Sans"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap';
      document.head.appendChild(link);
    }

    // Inject scoped styles
    const styleEl = document.createElement('style');
    styleEl.textContent = getStyles();
    document.head.appendChild(styleEl);

    // Inject HTML
    root.innerHTML = getHTML();

    // Bind events
    bindEvents(root);

    // Load conversations from API and render message list
    loadConversationList(root);
  }

  function loadConversationList(root) {
    var config = getConfig(root);
    var listEl = root.querySelector('.ac-list-msgs');
    if (!listEl) return;

    listEl.innerHTML = '<div class="ac-list-loading" style="padding:24px;text-align:center;color:#8b8fa3;font-size:14px;">Loading conversations…</div>';

    var accountId = config.accountId;
    var params = { accountId: accountId };

    Promise.all([
      apiGet(config.apiBase, 'conversations', params).catch(function () { return { conversations: [] }; }),
      apiGet(config.apiBase, 'unread-count', params).catch(function () { return { count: 0 }; }),
    ]).then(function (results) {
      var conversations = (results[0].conversations != null) ? results[0].conversations : (Array.isArray(results[0]) ? results[0] : []);
      var rawCount = results[1];
      var unreadCount = typeof rawCount === 'number' ? rawCount : (rawCount.count != null ? rawCount.count : (rawCount.unreadCount != null ? rawCount.unreadCount : 0));
      renderConversationList(root, listEl, conversations, unreadCount);
      updateNavBadge(unreadCount);
      bindListEvents(root);
      var firstActive = root.querySelector('.ac-msg.active');
      if (firstActive) {
        var rid = firstActive.dataset.recipientId || firstActive.dataset.id;
        if (rid) loadThread(root, rid);
      }
    }).catch(function () {
      listEl.innerHTML = '<div class="ac-list-loading" style="padding:24px;text-align:center;color:#8b8fa3;font-size:14px;">Unable to load conversations. Check data-api-base and network.</div>';
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
    var id = c.recipientId != null ? c.recipientId : (c.recipient_id != null ? c.recipient_id : (c.id != null ? c.id : ''));
    var recipient = c.recipient || c;
    var name = (recipient.name != null ? recipient.name : (recipient.displayName != null ? recipient.displayName : 'Unknown'));
    var last = c.lastMessage || c.last_message || {};
    var preview = (last.body != null ? last.body : (last.preview != null ? last.preview : (last.text != null ? last.text : '')));
    var rawAt = last.createdAt != null ? last.createdAt : (last.sentAt != null ? last.sentAt : (last.at != null ? last.at : last.date));
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
      removeMessageRow(dismissLink);
      return;
    }
    fetch((config.apiBase.replace(/\/$/, '')) + '/mark-read', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientId: recipientId }),
    }).then(function (res) {
      if (res.ok) removeMessageRow(dismissLink);
    }).catch(function () {
      removeMessageRow(dismissLink);
    });
  }
  function removeMessageRow(dismissLink) {
    var msg = dismissLink && dismissLink.closest('.ac-msg');
    if (msg) {
      msg.style.transition = 'opacity 0.3s';
      msg.style.opacity = '0';
      setTimeout(function () { msg.remove(); }, 300);
    }
  }

  function loadThread(root, recipientId) {
    var config = getConfig(root);
    if (!config.apiBase) return;
    apiGet(config.apiBase, 'thread/' + encodeURIComponent(recipientId), { accountId: config.accountId })
      .then(function (data) {
        renderThread(root, data, recipientId);
      })
      .catch(function () {
        // Keep existing convo UI or show error
      });
  }

  function renderThread(root, data, recipientId) {
    var thread = data.thread || data.messages || data;
    var messages = Array.isArray(thread) ? thread : (thread.messages || []);
    var recipient = data.recipient || (data.recipientId && { id: data.recipientId }) || {};
    var name = recipient.name || recipient.displayName || 'Unknown';
    var phone = recipient.phone || recipient.phoneNumber || '';
    var hdr = root.querySelector('.ac-convo-hdr');
    if (hdr) {
      var nameEl = hdr.querySelector('.ac-convo-name');
      var phoneEl = hdr.querySelector('.ac-convo-phone');
      if (nameEl) nameEl.textContent = name;
      if (phoneEl) phoneEl.textContent = phone;
    }
    var msgsEl = root.querySelector('.ac-msgs');
    if (!msgsEl) return;
    var html = '';
    messages.forEach(function (msg) {
      var dir = (msg.direction === 'out' || msg.outgoing || msg.fromMe) ? 'out' : 'in';
      var body = msg.body != null ? msg.body : (msg.text != null ? msg.text : '');
      var meta = msg.createdAt || msg.sentAt || msg.at || '';
      if (typeof meta === 'string' && meta) meta = new Date(meta).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      var flagged = msg.flagged || msg.requiresAttention ? ' flagged' : '';
      html += '<div class="ac-bubble ' + dir + flagged + '">' + escapeHtml(body) + '<div class="ac-meta">' + escapeHtml(meta) + '</div></div>';
    });
    msgsEl.innerHTML = html || '<div class="ac-sys">No messages in this thread.</div>';
    var replyBar = root.querySelector('#ac-reply-bar');
    if (replyBar && !replyBar.classList.contains('suppressed')) {
      var input = replyBar.querySelector('input');
      if (input) {
        input.placeholder = 'Type a message…';
        input.dataset.recipientId = recipientId;
      }
    }
  }

  function updateNavBadge(count) {
    const badge = document.getElementById('aftercare-text-nav-badge');
    if (badge) {
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  // ============================================================
  // STYLES (scoped to #aftercare-text-root)
  // ============================================================
  function getStyles() {
    const S = '#aftercare-text-root';
    return `
${S} { font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif; display: flex; flex-direction: column; height: 100%; color: #1a1a2e; }
${S} * { margin: 0; padding: 0; box-sizing: border-box; }

/* Top bar */
${S} .ac-topbar { display: flex; align-items: center; justify-content: space-between; padding: 12px 24px; background: #fff; border-bottom: 1px solid #e2e6ec; flex-shrink: 0; }
${S} .ac-topbar-left { font-size: 18px; font-weight: 700; color: #1a1a2e; }
${S} .ac-topbar-settings { font-size: 13px; font-weight: 500; color: #4a6cf7; text-decoration: none; padding: 7px 14px; border: 1px solid #dde1e8; border-radius: 6px; transition: all 0.15s; }
${S} .ac-topbar-settings:hover { border-color: #4a6cf7; background: #f0f3ff; }

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
${S} .ac-msgs { flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 12px; }
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
${S} .ac-reply { padding: 16px 24px; background: #fff; border-top: 1px solid #e2e6ec; display: flex; gap: 12px; align-items: center; }
${S} .ac-reply-wrap { flex: 1; position: relative; display: flex; align-items: center; }
${S} .ac-reply-wrap input { width: 100%; padding: 10px 70px 10px 14px; border: 1px solid #dde1e8; border-radius: 8px; font-size: 14px; font-family: inherit; background: #f8f9fb; outline: none; }
${S} .ac-reply-wrap input:focus { border-color: #4a6cf7; }
${S} .ac-reply-icons { position: absolute; right: 8px; display: flex; gap: 2px; }
${S} .ac-reply-ibtn { width: 30px; height: 30px; border: none; background: transparent; cursor: pointer; font-size: 16px; border-radius: 6px; display: flex; align-items: center; justify-content: center; opacity: 0.4; transition: opacity 0.15s; }
${S} .ac-reply-ibtn:hover { opacity: 0.8; }
${S} .ac-send-btn { padding: 10px 20px; background: #4a6cf7; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
${S} .ac-reply.suppressed { background: #fafafa; flex-direction: column; align-items: stretch; gap: 0; }
${S} .ac-suppressed { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: #f8f0e5; border: 1px solid #f0d8b0; border-radius: 8px; font-size: 13px; color: #8a6d00; line-height: 1.4; }
${S} .ac-suppressed-icon { font-size: 18px; flex-shrink: 0; }

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
<!-- Aftercare top bar -->
<div class="ac-topbar">
  <div class="ac-topbar-left">Aftercare Text</div>
  <a class="ac-topbar-settings" href="https://www.aftercare.com/system" target="_blank">⚙️ Aftercare Text Settings ↗</a>
</div>

<!-- Inbox -->
<div class="ac-inbox">
  <!-- Message list -->
  <div class="ac-list">
    <div class="ac-list-msgs">
      <div class="ac-group-hdr">Needs Attention <span class="ac-group-count">2</span></div>
      <div class="ac-msg active" data-id="margaret">
        <div class="ac-msg-ind"><span class="ac-sparkle">✦</span></div>
        <div class="ac-msg-body">
          <div class="ac-msg-top">
            <span class="ac-msg-name">Margaret Williams</span>
            <span class="ac-msg-date">2:02 PM</span>
          </div>
          <div class="ac-msg-preview">Thank you so much for remembering us. Could you tell me about grief coun...</div>
          <div class="ac-dismiss" data-resolve="margaret">Mark resolved</div>
        </div>
      </div>
      <div class="ac-msg" data-id="david">
        <div class="ac-msg-ind"><span class="ac-sparkle">✦</span></div>
        <div class="ac-msg-body">
          <div class="ac-msg-top">
            <span class="ac-msg-name">David Chen</span>
            <span class="ac-msg-date">11:30 AM</span>
          </div>
          <div class="ac-msg-preview">I appreciate that.. but what day are we remembering</div>
          <div class="ac-dismiss" data-resolve="david">Mark resolved</div>
        </div>
      </div>
      <div class="ac-divider"></div>
      <div class="ac-msg" data-id="sarah">
        <div class="ac-msg-ind"></div>
        <div class="ac-msg-body">
          <div class="ac-msg-top">
            <span class="ac-msg-name">Sarah Johnson</span>
            <span class="ac-msg-date">Yesterday</span>
          </div>
          <div class="ac-msg-preview">Thank you 🙏</div>
        </div>
      </div>
      <div class="ac-msg" data-id="patricia">
        <div class="ac-msg-ind"></div>
        <div class="ac-msg-body">
          <div class="ac-msg-top">
            <span class="ac-msg-name">Patricia Davis</span>
            <span class="ac-msg-date">Feb 14</span>
          </div>
          <div class="ac-msg-preview">That means so much. God bless you all.</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Conversation -->
  <div class="ac-convo">
    <div class="ac-convo-hdr">
      <div>
        <div class="ac-convo-name">Margaret Williams</div>
        <div class="ac-convo-phone">910-555-0147</div>
      </div>
      <div class="ac-convo-sep"></div>
      <div>
        <div class="ac-convo-dec">Robert Williams</div>
        <div class="ac-convo-ddate">d. 1/2/2026</div>
      </div>
    </div>
    <div class="ac-msgs">
      <div class="ac-sys">30-day Check-up</div>
      <div class="ac-bubble out">
        Hello Margaret, this is Sonzini Mortuary and we wanted to thank you for allowing us to serve your family during this difficult time. If there is anything we can do for you, now or in the future, please let us know.
        <div class="ac-meta">Feb 3</div>
      </div>
      <div class="ac-sys">Holiday Message</div>
      <div class="ac-bubble out">
        Wishing you a peaceful holiday season and a blessed new year. The staff at Sonzini Mortuary.
        <div class="ac-meta">Dec 10</div>
      </div>
      <div class="ac-sys">First Anniversary</div>
      <div class="ac-bubble out">
        Please know that you are being remembered on this day and that all of us at Sonzini Mortuary are thinking of you.
        <div class="ac-meta">Feb 17</div>
      </div>
      <div class="ac-bubble in flagged">
        Thank you so much for remembering us. Could you tell me about grief counseling options you mentioned at the service?
        <div class="ac-meta" style="color:#8b8fa3;">Feb 18, 2:02 PM</div>
      </div>
      <div class="ac-flag">
        ✦ Asking about grief counseling resources <span class="ac-flag-notif">· Notification sent to FH</span>
      </div>
    </div>
    <div class="ac-reply" id="ac-reply-bar">
      <div class="ac-reply-wrap">
        <input placeholder="" />
        <div class="ac-reply-icons">
          <button class="ac-reply-ibtn" title="Emoji">😊</button>
          <button class="ac-reply-ibtn" title="Attach image">🖼️</button>
        </div>
      </div>
      <button class="ac-send-btn">Send</button>
    </div>
  </div>

  <!-- Detail panel -->
  <div class="ac-detail">
    <div>
      <h4>Message Schedule</h4>
      <div class="ac-sched sent" data-msg="30day"><span class="ac-sched-check">✓</span><span class="ac-sched-name">30-day Check-up</span><span class="ac-sched-date">Feb 3</span></div>
      <div class="ac-sched sent" data-msg="review"><span class="ac-sched-check">✓</span><span class="ac-sched-name">Google Review</span><span class="ac-sched-date">Feb 18</span></div>
      <div class="ac-sched" data-msg="birthday"><span class="ac-sched-pend"></span><span class="ac-sched-name">Birthday</span><span class="ac-sched-date">Mar 15</span></div>
      <div class="ac-sched" data-msg="holiday"><span class="ac-sched-pend"></span><span class="ac-sched-name">Holiday</span><span class="ac-sched-date">Dec 10</span></div>
      <div class="ac-sched" data-msg="anniversary"><span class="ac-sched-pend"></span><span class="ac-sched-name">1st Anniversary</span><span class="ac-sched-date">Jan 2</span></div>
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
    <h3>Stop Messages for Margaret Williams?</h3>
    <p>This will cancel all future scheduled text messages for this family and suppress their phone number from receiving any further texts.</p>
    <div class="ac-confirm-warn">⚠️ This action cannot be undone.</div>
    <p style="font-size:13px;">Remaining scheduled messages that will be cancelled:</p>
    <div style="font-size:13px; color:#1a1a2e; margin-top:4px; padding-left:8px;">
      <div style="margin-bottom:3px;">• Birthday Message (Mar 15)</div>
      <div style="margin-bottom:3px;">• Holiday Message (Dec 10)</div>
      <div>• 1st Anniversary (Jan 2)</div>
    </div>
    <div class="ac-confirm-acts">
      <button class="ac-cancel-btn" id="ac-stop-cancel">Cancel</button>
      <button class="ac-stop-btn" id="ac-stop-confirm">Stop All Messages</button>
    </div>
  </div>
</div>
`;
  }

  // ============================================================
  // EVENT BINDING
  // ============================================================
  function bindEvents(root) {
    const msgData = {
      '30day': { title: '30-day Check-up', timing: 'Sent 2/3/26 2:00 PM', sent: true,
        text: 'Hello Margaret, this is Sonzini Mortuary and we wanted to thank you for allowing us to serve your family during this difficult time. If there is anything we can do for you, now or in the future, please let us know.' },
      'review': { title: 'Google Review', timing: 'Sent 2/18/26 2:00 PM', sent: true,
        text: 'Hi Margaret, all of us at Sonzini Mortuary are dedicated to providing excellent service to our families. One way we measure how we are doing is by asking our families to answer a few short questions about our service. Would you mind doing that? It would only take a few minutes. Thank you!' },
      'birthday': { title: 'Birthday Message', timing: 'Scheduled for Mar 15', sent: false,
        text: 'Hi Margaret, we understand how meaningful and yet difficult the birthday of your loved one can be, so please know we are thinking about you today.\n\nThe staff at Sonzini Mortuary' },
      'holiday': { title: 'Holiday Message', timing: 'Scheduled for Dec 10', sent: false,
        text: 'Wishing you a peaceful holiday season and a blessed new year.\n\nThe staff at Sonzini Mortuary' },
      'anniversary': { title: 'First Anniversary', timing: 'Scheduled for Jan 2', sent: false,
        text: 'Please know that you are being remembered on this day and that all of us at Sonzini Mortuary are thinking of you.' }
    };

    // Schedule item clicks → open preview modal
    root.querySelectorAll('.ac-sched').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.msg;
        const d = msgData[id];
        if (!d) return;
        root.querySelector('#ac-modal-title').textContent = d.title;
        root.querySelector('#ac-modal-timing').textContent = d.timing;
        root.querySelector('#ac-modal-msg').textContent = d.text;
        root.querySelector('#ac-modal-del').style.display = d.sent ? 'none' : 'inline-block';
        root.querySelector('#ac-msg-modal').classList.add('visible');
      });
    });

    // Close message modal
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
      root.querySelector('#ac-stop-modal').classList.remove('visible');
      const replyBar = root.querySelector('#ac-reply-bar');
      replyBar.className = 'ac-reply suppressed';
      replyBar.innerHTML = '<div class="ac-suppressed"><span class="ac-suppressed-icon">🚫</span><div>This family no longer wants to receive messages. Their number has been suppressed and all future messages have been cancelled.</div></div>';
      root.querySelector('#ac-stop-wrap').style.display = 'none';
      root.querySelectorAll('.ac-sched:not(.sent)').forEach(item => {
        item.style.opacity = '0.35';
        item.style.textDecoration = 'line-through';
        item.style.pointerEvents = 'none';
      });
    });

    // Dismiss / Mark resolved
    root.querySelectorAll('.ac-dismiss').forEach(link => {
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        // In production this would call the API. For demo, just remove the item.
        const msg = link.closest('.ac-msg');
        if (msg) {
          msg.style.transition = 'opacity 0.3s';
          msg.style.opacity = '0';
          setTimeout(() => msg.remove(), 300);
        }
      });
    });
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
