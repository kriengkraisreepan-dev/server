'use strict';

// Admin web (no framework). Every API call sends the x-hub-admin header (CSRF guard).
(function () {
  const $ = (id) => document.getElementById(id);
  const SWITCH_LABELS = { ai_chat: 'AI ตอบแชท', publishing: 'การโพสต์', bridge: 'Bridge (เครื่องร้าน)' };
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '—');

  async function api(method, path, body) {
    const res = await fetch('/admin/api' + path, {
      method,
      credentials: 'same-origin',
      headers: { 'x-hub-admin': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/login') showLogin();
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
    return data;
  }

  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of children) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }

  function showLogin() {
    $('login-view').hidden = false;
    $('app-view').hidden = true;
    $('logout').hidden = true;
  }

  async function showApp() {
    $('login-view').hidden = true;
    $('app-view').hidden = false;
    $('logout').hidden = false;
    await refresh();
  }

  function statusBadge(d) {
    if (d.revokedAt) return el('span', { class: 'badge off' }, 'ถูกยกเลิก');
    if (!d.online) return el('span', { class: 'badge bad' }, 'offline');
    if (!d.snapshot || d.snapshot.stale) return el('span', { class: 'badge warn' }, 'online · ข้อมูลเก่า');
    return el('span', { class: 'badge ok' }, 'online');
  }

  async function refresh() {
    const [{ killSwitches }, { devices }, { entries }] = await Promise.all([
      api('GET', '/kill-switches'),
      api('GET', '/devices'),
      api('GET', '/audit?limit=30'),
    ]);

    $('kill-switches').replaceChildren(
      ...Object.entries(killSwitches).map(([name, s]) =>
        el('div', { class: 'switch' },
          el('span', {}, SWITCH_LABELS[name] || name, ' ', el('span', { class: 'badge ' + (s.enabled ? 'ok' : 'bad') }, s.enabled ? 'เปิด' : 'ปิด')),
          el('button', {
            class: s.enabled ? 'danger' : '',
            onclick: async () => {
              if (s.enabled && !confirm(`ปิด "${SWITCH_LABELS[name]}" ทันที?`)) return;
              await api('PUT', '/kill-switches/' + name, { enabled: !s.enabled });
              await refresh();
            },
          }, s.enabled ? 'ปิด' : 'เปิด'))),
    );

    $('devices').replaceChildren(
      ...(devices.length ? devices.map((d) =>
        el('tr', {},
          el('td', {}, d.deviceName),
          el('td', {}, statusBadge(d)),
          el('td', {}, d.snapshot ? `${fmt(d.snapshot.asOf)} (#${d.snapshot.seq})` : '—'),
          el('td', {}, d.appVersion),
          el('td', {}, fmt(d.pairedAt)),
          el('td', {}, d.revokedAt ? '' : el('span', {},
            el('button', { class: 'ghost', onclick: async () => { await api('POST', `/devices/${encodeURIComponent(d.deviceId)}/rotate-token`); await refresh(); } }, 'เปลี่ยน token'), ' ',
            el('button', { class: 'danger', onclick: async () => {
              if (!confirm(`ยกเลิกเครื่อง "${d.deviceName}"? การเชื่อมต่อจะถูกตัดทันที`)) return;
              await api('POST', `/devices/${encodeURIComponent(d.deviceId)}/revoke`);
              await refresh();
            } }, 'Revoke'))),
        )) : [el('tr', {}, el('td', { colspan: '6', class: 'hint' }, 'ยังไม่มีเครื่องร้าน'))]),
    );

    $('audit').replaceChildren(...entries.map((e) => el('tr', {}, el('td', {}, fmt(e.at)), el('td', {}, e.actor), el('td', {}, e.action), el('td', {}, e.target || ''))));
  }

  $('login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('login-error').textContent = '';
    try {
      await api('POST', '/login', { password: $('password').value });
      $('password').value = '';
      await showApp();
    } catch (err) {
      $('login-error').textContent = err.status === 429 ? 'ลองหลายครั้งเกินไป รอสักครู่' : 'รหัสผ่านไม่ถูกต้อง';
    }
  });

  $('logout').addEventListener('click', async () => {
    await api('POST', '/logout').catch(() => {});
    showLogin();
  });

  $('new-code').addEventListener('click', async () => {
    try {
      const { code, expiresAt } = await api('POST', '/pairing-codes');
      $('pairing-code').textContent = code;
      $('pairing-expiry').textContent = fmt(expiresAt);
      $('pairing').hidden = false;
      await refresh();
    } catch (err) {
      alert(err.message === 'bridge_disabled' ? 'Kill switch "Bridge" ปิดอยู่' : 'สร้าง code ไม่สำเร็จ');
    }
  });

  api('GET', '/me').then(showApp, showLogin);
  setInterval(() => { if (!$('app-view').hidden) refresh().catch(() => {}); }, 10000);
})();
