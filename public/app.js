const state = {
  guilds: [],
  channels: [],
  roles: [],
  selectedGuild: null,
  selectedChannel: null,
  config: null,
  imageFile: null, // File object when uploaded from Photos
  mentionRoleIds: [],
  scheduledPollTimer: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('Not authenticated');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------- Auth ----------
function showLogin() {
  $('#login-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
}
function showApp() {
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  boot();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('#password-input').value;
  $('#login-error').textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
    showApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  showLogin();
});

async function checkSession() {
  const { authed } = await api('/api/session');
  if (authed) showApp();
  else showLogin();
}

// ---------- Nav ----------
$$('.rail-item[data-view]').forEach((item) => {
  item.addEventListener('click', () => switchView(item.dataset.view));
});

function switchView(view) {
  $$('.rail-item[data-view]').forEach((i) => i.classList.toggle('active', i.dataset.view === view));
  $$('.view').forEach((v) => v.classList.remove('active'));
  $(`#view-${view}`).classList.add('active');
  if (view === 'permissions') loadRoleSelectOptions();
}

// ---------- Boot ----------
async function boot() {
  await Promise.all([refreshBotStatus(), loadConfig()]);
  await loadGuilds();
  bindComposeListeners();
  bindPreviewEditing();
  bindImageUpload();
  bindScheduling();
  renderPreview();
  refreshScheduledList();
  setInterval(refreshBotStatus, 15000);
  state.scheduledPollTimer = setInterval(refreshScheduledList, 20000);
}

async function refreshBotStatus() {
  try {
    const { ready, info } = await api('/api/bot/status');
    $('#bot-status-dot').classList.toggle('online', ready);
    $('#bot-ready-label').textContent = ready ? 'online' : 'connecting';
    if (info) {
      $('#bot-tag').textContent = info.tag;
      $('#bot-avatar').src = info.avatar;
      $('#prev-bot-avatar').src = info.avatar;
    }
  } catch (e) {}
}

async function loadConfig() {
  state.config = await api('/api/config');
  $('#prev-bot-name').textContent = state.config.botName;
  populatePresetDropdown();
  renderPresetsList();
  fillIdentityForm();
  fillPermissionsForm();
  if (document.querySelector('#f-ping-everyone')) applyMentionToggleAvailability();
  renderPreview();
}

// ---------- Guilds / channels ----------
async function loadGuilds() {
  state.guilds = await api('/api/guilds');
  const sel = $('#guild-select');
  sel.innerHTML = state.guilds.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
  if (state.guilds.length) {
    state.selectedGuild = state.guilds[0].id;
    sel.value = state.selectedGuild;
    await loadChannelsAndRoles(state.selectedGuild);
  }
}

$('#guild-select').addEventListener('change', async (e) => {
  state.selectedGuild = e.target.value;
  await loadChannelsAndRoles(state.selectedGuild);
});

async function loadChannelsAndRoles(guildId) {
  const [channels, roles] = await Promise.all([
    api(`/api/guilds/${guildId}/channels`),
    api(`/api/guilds/${guildId}/roles`),
  ]);
  state.channels = channels;
  state.roles = roles;

  const chSel = $('#f-channel-select');
  chSel.innerHTML = channels.map((c) => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');
  if (channels.length) {
    state.selectedChannel = channels[0].id;
    chSel.value = state.selectedChannel;
  } else {
    state.selectedChannel = null;
  }
  state.mentionRoleIds = [];
  renderAllowedRolesChips();
  loadRoleSelectOptions();
  renderMentionRoleOptions();
  renderMentionChips();
}

$('#f-channel-select').addEventListener('change', (e) => {
  state.selectedChannel = e.target.value;
});

// ---------- Compose / preview ----------
function populatePresetDropdown() {
  const sel = $('#f-preset');
  const keys = Object.keys(state.config.presets);
  sel.innerHTML = '<option value="">No preset</option>' + keys.map((k) => `<option value="${k}">${escapeHtml(k)}</option>`).join('');
}

function bindComposeListeners() {
  ['f-message', 'f-title', 'f-author', 'f-image'].forEach((id) => $('#' + id).addEventListener('input', renderPreview));
  $('#f-message').addEventListener('input', updateCharCount);
  $('#f-preset').addEventListener('change', renderPreview);
  $('#f-ping-everyone').addEventListener('change', renderPreview);
  $('#f-ping-here').addEventListener('change', renderPreview);
  $('#f-color').addEventListener('input', (e) => {
    $('#f-color-text').value = e.target.value;
    renderPreview();
  });
  $('#f-color-text').addEventListener('input', (e) => {
    if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) $('#f-color').value = e.target.value;
    renderPreview();
  });
  $('#prev-embed-image-remove').addEventListener('click', () => {
    $('#f-image').value = '';
    state.imageFile = null;
    $('#f-image-filename').textContent = '';
    renderPreview();
  });

  applyMentionToggleAvailability();
  updateCharCount();
}

function applyMentionToggleAvailability() {
  const everyoneAllowed = !!state.config.mentionOptions.everyone;
  const hereAllowed = !!state.config.mentionOptions.here;
  $('#ping-everyone-disabled-note').classList.toggle('hidden', everyoneAllowed);
  $('#f-ping-everyone').disabled = !everyoneAllowed;
  $('#ping-here-disabled-note').classList.toggle('hidden', hereAllowed);
  $('#f-ping-here').disabled = !hereAllowed;
}

function updateCharCount() {
  const len = $('#f-message').value.length;
  const counter = $('#f-message-count');
  counter.textContent = len;
  counter.parentElement.classList.toggle('over-limit', len > 4000);
}

function currentColor() {
  const presetKey = $('#f-preset').value;
  const preset = presetKey ? state.config.presets[presetKey] : null;
  const custom = $('#f-color-text').value.trim();
  if (custom && /^#[0-9a-fA-F]{6}$/.test(custom)) return custom;
  if (preset) return preset.color;
  return state.config.defaultColor;
}

function currentImageSrc() {
  if (state.imageFile) return URL.createObjectURL(state.imageFile);
  return $('#f-image').value.trim();
}

function renderPreview() {
  const message = $('#f-message').value;
  const title = $('#f-title').value.trim();
  const author = $('#f-author').value.trim();
  const presetKey = $('#f-preset').value;
  const preset = presetKey ? state.config.presets[presetKey] : null;
  const pingEveryone = $('#f-ping-everyone').checked && state.config.mentionOptions.everyone;
  const pingHere = !pingEveryone && $('#f-ping-here').checked && state.config.mentionOptions.here;

  const color = currentColor();
  $('.discord-embed').style.setProperty('--embed-color', color);

  const authorEl = $('#prev-embed-author');
  if (document.activeElement !== authorEl) authorEl.textContent = author;
  authorEl.classList.toggle('hidden', !author && document.activeElement !== authorEl);

  const icon = preset && preset.emoji ? preset.emoji + ' ' : '';
  const displayTitle = title ? icon + title : icon + state.config.botName;
  const titleEl = $('#prev-embed-title');
  if (document.activeElement !== titleEl) titleEl.textContent = displayTitle;

  const descEl = $('#prev-embed-desc');
  if (document.activeElement !== descEl) descEl.textContent = message;

  const imgWrap = $('#prev-embed-image-wrap');
  const imgEl = $('#prev-embed-image');
  const imageSrc = currentImageSrc();
  if (imageSrc) {
    imgEl.src = imageSrc;
    imgWrap.classList.remove('hidden');
    imgEl.onerror = () => imgWrap.classList.add('hidden');
  } else {
    imgWrap.classList.add('hidden');
  }

  const thumbEl = $('#prev-embed-thumb');
  if (state.config.thumbnailUrl) {
    thumbEl.src = state.config.thumbnailUrl;
    thumbEl.classList.remove('hidden');
    thumbEl.onerror = () => thumbEl.classList.add('hidden');
  } else thumbEl.classList.add('hidden');

  $('#prev-embed-footer').textContent = (state.config.footerText || '') + ' • Today at 12:00 PM';

  const mentionLabels = [];
  if (pingEveryone) mentionLabels.push('@everyone');
  else if (pingHere) mentionLabels.push('@here');
  state.mentionRoleIds.forEach((id) => {
    const role = state.roles.find((r) => r.id === id);
    mentionLabels.push(role ? `@${role.name}` : '@role');
  });

  const contentEl = $('#prev-content');
  contentEl.textContent = mentionLabels.join(' ');
  contentEl.classList.toggle('hidden', !mentionLabels.length);
}

// ---------- Click-to-edit preview (contenteditable synced to form) ----------
function bindPreviewEditing() {
  const map = {
    author: '#f-author',
    title: '#f-title',
    message: '#f-message',
  };
  $$('.editable[data-field]').forEach((el) => {
    const formSel = map[el.dataset.field];
    if (!formSel) return;

    el.addEventListener('focus', () => {
      if (el.dataset.field === 'author') el.classList.remove('hidden');
    });

    el.addEventListener('input', () => {
      const text = el.textContent;
      $(formSel).value = text;
      if (el.dataset.field === 'message') updateCharCount();
    });

    el.addEventListener('blur', () => {
      renderPreview();
    });

    // Enter submits/blurs single-line fields instead of inserting a newline
    if (el.dataset.field !== 'message') {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          el.blur();
        }
      });
    }
  });
}

// ---------- Image upload from Photos ----------
function bindImageUpload() {
  $('#f-image-upload-btn').addEventListener('click', () => $('#f-image-file').click());
  $('#f-image-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      $('#send-status').textContent = 'Image must be under 8MB.';
      $('#send-status').className = 'send-status err';
      e.target.value = '';
      return;
    }
    state.imageFile = file;
    $('#f-image').value = '';
    $('#f-image-filename').textContent = file.name;
    renderPreview();
  });
  $('#f-image').addEventListener('input', () => {
    if ($('#f-image').value.trim()) {
      state.imageFile = null;
      $('#f-image-filename').textContent = '';
      $('#f-image-file').value = '';
    }
  });
}

// ---------- Mention roles ----------
function renderMentionRoleOptions() {
  const sel = $('#mention-role-select');
  const chosen = new Set(state.mentionRoleIds);
  sel.innerHTML =
    '<option value="">Add a role to mention…</option>' +
    state.roles.filter((r) => !chosen.has(r.id)).map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
}

function renderMentionChips() {
  const wrap = $('#mention-roles-chips');
  if (!state.mentionRoleIds.length) {
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML = state.mentionRoleIds
    .map((id) => {
      const role = state.roles.find((r) => r.id === id);
      const label = role ? role.name : id;
      return `<span class="role-chip">${escapeHtml(label)}<button data-id="${escapeAttr(id)}" title="Remove">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
      </button></span>`;
    })
    .join('');
  wrap.querySelectorAll('button[data-id]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.mentionRoleIds = state.mentionRoleIds.filter((id) => id !== btn.dataset.id);
      renderMentionRoleOptions();
      renderMentionChips();
      renderPreview();
    })
  );
}

$('#mention-role-select').addEventListener('change', (e) => {
  if (!e.target.value) return;
  state.mentionRoleIds.push(e.target.value);
  e.target.value = '';
  renderMentionRoleOptions();
  renderMentionChips();
  renderPreview();
});

// ---------- Scheduling ----------
function bindScheduling() {
  $('#f-schedule-toggle').addEventListener('change', (e) => {
    $('#schedule-row').classList.toggle('hidden', !e.target.checked);
    if (e.target.checked && !$('#f-schedule-when').value) {
      const soon = new Date(Date.now() + 15 * 60000);
      soon.setSeconds(0, 0);
      $('#f-schedule-when').value = new Date(soon.getTime() - soon.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    }
  });
}

async function refreshScheduledList() {
  try {
    const items = await api('/api/announce/scheduled');
    const wrap = $('#scheduled-list');
    if (!items.length) {
      wrap.innerHTML = '<div class="empty-state">Nothing scheduled.</div>';
      return;
    }
    wrap.innerHTML = items
      .map((s) => {
        const when = new Date(s.sendAt).toLocaleString();
        return `<div class="list-card">
          <div class="list-card-title">${escapeHtml(s.title || '(no title)')}</div>
          <div class="list-card-meta">${escapeHtml(when)}</div>
          <div class="list-card-actions">
            <button class="btn-danger cancel-scheduled-btn" data-id="${escapeAttr(s.id)}">Cancel</button>
          </div>
        </div>`;
      })
      .join('');
    wrap.querySelectorAll('.cancel-scheduled-btn').forEach((btn) =>
      btn.addEventListener('click', async () => {
        await api(`/api/announce/scheduled/${btn.dataset.id}`, { method: 'DELETE' });
        refreshScheduledList();
      })
    );
  } catch (e) {}
}

$('#send-now-btn').addEventListener('click', async () => {
  const statusEl = $('#send-status');
  statusEl.className = 'send-status';

  const message = $('#f-message').value.trim();
  if (!message) {
    statusEl.textContent = 'Message is required.';
    statusEl.classList.add('err');
    return;
  }
  if (message.length > 4000) {
    statusEl.textContent = 'Message is too long (4000 character limit).';
    statusEl.classList.add('err');
    return;
  }
  if (!state.selectedChannel) {
    statusEl.textContent = 'Pick a channel first.';
    statusEl.classList.add('err');
    return;
  }

  const isScheduled = $('#f-schedule-toggle').checked;
  let sendAt = null;
  if (isScheduled) {
    const when = $('#f-schedule-when').value;
    if (!when) {
      statusEl.textContent = 'Pick a date and time to schedule for.';
      statusEl.classList.add('err');
      return;
    }
    sendAt = new Date(when).getTime();
    if (sendAt <= Date.now() + 5000) {
      statusEl.textContent = 'Scheduled time must be at least a few seconds in the future.';
      statusEl.classList.add('err');
      return;
    }
  }

  const fields = {
    channelId: state.selectedChannel,
    message,
    title: $('#f-title').value.trim(),
    author: $('#f-author').value.trim(),
    presetKey: $('#f-preset').value,
    color: $('#f-color-text').value.trim(),
    image: state.imageFile ? '' : $('#f-image').value.trim(),
    pingEveryone: $('#f-ping-everyone').checked,
    pingHere: $('#f-ping-here').checked,
    mentionRoleIds: state.mentionRoleIds,
    sendAt: sendAt || undefined,
  };

  statusEl.textContent = isScheduled ? 'Scheduling…' : 'Sending…';
  try {
    let result;
    if (state.imageFile) {
      const form = new FormData();
      Object.entries(fields).forEach(([key, val]) => {
        if (val === undefined) return;
        form.append(key, key === 'mentionRoleIds' ? JSON.stringify(val) : val);
      });
      form.append('imageFile', state.imageFile);
      const res = await fetch('/api/announce/send', { method: 'POST', body: form });
      if (res.status === 401) { showLogin(); throw new Error('Not authenticated'); }
      result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Request failed');
    } else {
      result = await api('/api/announce/send', { method: 'POST', body: JSON.stringify(fields) });
    }

    statusEl.textContent = result.scheduled ? 'Scheduled.' : 'Sent.';
    statusEl.classList.add('ok');
    if (result.scheduled) {
      $('#f-schedule-toggle').checked = false;
      $('#schedule-row').classList.add('hidden');
      refreshScheduledList();
    }
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add('err');
  }
});

// ---------- Presets view ----------
function renderPresetsList() {
  const wrap = $('#presets-list');
  const keys = Object.keys(state.config.presets);
  if (!keys.length) {
    wrap.innerHTML = '<div class="empty-state">No presets yet. Add one below.</div>';
    return;
  }
  wrap.innerHTML = keys
    .map((key) => {
      const p = state.config.presets[key];
      return `
      <div class="list-card">
        <div class="preset-swatch" style="background:${escapeAttr(p.color)}"></div>
        <div class="list-card-title">${p.emoji ? escapeHtml(p.emoji) + ' ' : ''}${escapeHtml(key)}</div>
        <div class="list-card-meta">${escapeHtml(p.color)}</div>
        <div class="list-card-actions">
          <button class="btn-danger delete-preset-btn" data-key="${escapeAttr(key)}">Delete</button>
        </div>
      </div>`;
    })
    .join('');

  wrap.querySelectorAll('.delete-preset-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await api(`/api/config/presets/${encodeURIComponent(btn.dataset.key)}`, { method: 'DELETE' });
      await loadConfig();
    })
  );
}

$('#new-preset-color').addEventListener('input', (e) => {
  $('#new-preset-color-text').value = e.target.value;
});
$('#new-preset-color-text').addEventListener('input', (e) => {
  if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) $('#new-preset-color').value = e.target.value;
});

$('#add-preset-btn').addEventListener('click', async () => {
  const statusEl = $('#preset-add-status');
  const key = $('#new-preset-key').value.trim().toLowerCase().replace(/\s+/g, '-');
  const color = $('#new-preset-color-text').value.trim();
  const emoji = $('#new-preset-emoji').value.trim();

  if (!key) {
    statusEl.textContent = 'Key is required.';
    statusEl.className = 'send-status err';
    return;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    statusEl.textContent = 'Enter a valid hex color.';
    statusEl.className = 'send-status err';
    return;
  }

  try {
    await api(`/api/config/presets/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ color, emoji }),
    });
    statusEl.textContent = 'Preset added.';
    statusEl.className = 'send-status ok';
    $('#new-preset-key').value = '';
    $('#new-preset-emoji').value = '';
    await loadConfig();
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'send-status err';
  }
});

// ---------- Identity view ----------
function fillIdentityForm() {
  const c = state.config;
  $('#cfg-botName').value = c.botName || '';
  $('#cfg-defaultColor').value = c.defaultColor || '#5865f2';
  $('#cfg-defaultColor-text').value = c.defaultColor || '#5865f2';
  $('#cfg-footerText').value = c.footerText || '';
  $('#cfg-footerIconUrl').value = c.footerIconUrl || '';
  $('#cfg-thumbnailUrl').value = c.thumbnailUrl || '';
}

$('#cfg-defaultColor').addEventListener('input', (e) => {
  $('#cfg-defaultColor-text').value = e.target.value;
});
$('#cfg-defaultColor-text').addEventListener('input', (e) => {
  if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) $('#cfg-defaultColor').value = e.target.value;
});

$('#save-identity-btn').addEventListener('click', async () => {
  const statusEl = $('#identity-status');
  const next = {
    ...state.config,
    botName: $('#cfg-botName').value.trim() || 'Announcer',
    defaultColor: $('#cfg-defaultColor-text').value.trim(),
    footerText: $('#cfg-footerText').value.trim(),
    footerIconUrl: $('#cfg-footerIconUrl').value.trim(),
    thumbnailUrl: $('#cfg-thumbnailUrl').value.trim(),
  };
  try {
    await api('/api/config', { method: 'PUT', body: JSON.stringify(next) });
    statusEl.textContent = 'Saved.';
    statusEl.className = 'send-status ok';
    await loadConfig();
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'send-status err';
  }
});

// ---------- Permissions view ----------
function fillPermissionsForm() {
  $('#cfg-mention-everyone').checked = !!state.config.mentionOptions.everyone;
  $('#cfg-mention-here').checked = !!state.config.mentionOptions.here;
  renderAllowedRolesChips();
}

function renderAllowedRolesChips() {
  const wrap = $('#allowed-roles-list');
  const ids = state.config.allowedRoleIds || [];
  if (!ids.length) {
    wrap.innerHTML = '<div class="hint-text" style="margin:0">No roles added — anyone with Manage Messages can announce.</div>';
    return;
  }
  wrap.innerHTML = ids
    .map((id) => {
      const role = state.roles.find((r) => r.id === id);
      const label = role ? role.name : id;
      return `<span class="role-chip">${escapeHtml(label)}<button data-id="${escapeAttr(id)}" title="Remove">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
      </button></span>`;
    })
    .join('');

  wrap.querySelectorAll('button[data-id]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.config.allowedRoleIds = state.config.allowedRoleIds.filter((id) => id !== btn.dataset.id);
      renderAllowedRolesChips();
    })
  );
}

function loadRoleSelectOptions() {
  const sel = $('#add-role-select');
  const already = new Set(state.config?.allowedRoleIds || []);
  sel.innerHTML = state.roles
    .filter((r) => !already.has(r.id))
    .map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`)
    .join('');
}

$('#add-role-btn').addEventListener('click', () => {
  const sel = $('#add-role-select');
  if (!sel.value) return;
  state.config.allowedRoleIds = [...(state.config.allowedRoleIds || []), sel.value];
  renderAllowedRolesChips();
  loadRoleSelectOptions();
});

$('#save-permissions-btn').addEventListener('click', async () => {
  const statusEl = $('#permissions-status');
  const next = {
    ...state.config,
    allowedRoleIds: state.config.allowedRoleIds || [],
    mentionOptions: {
      everyone: $('#cfg-mention-everyone').checked,
      here: $('#cfg-mention-here').checked,
    },
  };
  try {
    await api('/api/config', { method: 'PUT', body: JSON.stringify(next) });
    statusEl.textContent = 'Saved.';
    statusEl.className = 'send-status ok';
    await loadConfig();
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'send-status err';
  }
});

// ---------- Utils ----------
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str || '');
}

checkSession();
