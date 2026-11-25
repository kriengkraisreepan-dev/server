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
    await Promise.all([refresh(), refreshChat(), loadShopInfo(), loadFaq(), loadAssets(), loadTemplates()]);
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

  // ---- A4: AI ตอบแชท ----
  const HANDOFF_TH = {
    booking: 'ขอจอง', complaint: 'ร้องเรียน', money: 'เรื่องเงิน', lost_item: 'ของหาย', accident: 'อุบัติเหตุ',
    threat: 'ข่มขู่', asked_for_human: 'ขอคุยกับพนักงาน', unsure: 'AI ไม่มั่นใจ', rate_limit: 'ส่งถี่เกินไป',
    staff_replied: 'พนักงานตอบเองแล้ว', owner: 'เจ้าของกดให้พนักงานตอบ', reply_blocked: 'AI ตอบไม่ผ่านกฎ',
    ai_error: 'ระบบ AI ขัดข้อง', no_shop_data: 'ไม่มีข้อมูลจากเครื่องร้าน', attachment: 'ส่งรูป/ไฟล์', other: 'อื่น ๆ',
  };
  const ROLE_TH = { customer: 'ลูกค้า', ai: 'AI', staff: 'พนักงาน', system: 'ระบบ' };
  let openConv = null;

  function msgBubble(role, text, at) {
    return el('div', { class: 'msg ' + role }, el('small', {}, `${ROLE_TH[role] || role}${at ? ' · ' + fmt(at) : ''}`), text || '');
  }

  async function refreshChat() {
    const [summary, { conversations }] = await Promise.all([
      api('GET', '/chat/summary'),
      api('GET', '/conversations' + ($('conv-handoff-only').checked ? '?handoff=1' : '')),
    ]);
    const ai = summary.ai || {};
    $('ai-info').textContent = [
      ai.provider === 'claude' ? `ใช้ AI: Claude (${ai.model})` : 'ใช้ AI: แบบฟรี (ตอบตามคำสำคัญ ยังไม่ได้ใส่รหัส Claude)',
      ai.messengerConfigured ? 'เชื่อมเพจ Facebook แล้ว' : 'ยังไม่ได้เชื่อมเพจ Facebook',
      summary.aiChatEnabled ? 'AI ตอบแชท: เปิด' : 'AI ตอบแชท: ปิด (ลูกค้าจะได้ข้อความ "พนักงานจะตอบกลับโดยเร็ว")',
    ].join(' · ');
    $('handoff-badge').hidden = !summary.handoffCount;
    $('handoff-badge').textContent = `รอพนักงานตอบ ${summary.handoffCount} แชท`;

    $('conversations').replaceChildren(
      ...(conversations.length ? conversations.map((c) =>
        el('tr', {},
          el('td', {}, `Facebook ${c.customerLabel}`),
          el('td', {}, c.handoff
            ? el('span', { class: 'badge warn' }, 'รอพนักงาน: ' + (HANDOFF_TH[c.handoffReason] || c.handoffReason || ''))
            : el('span', { class: 'badge ok' }, 'AI ตอบอยู่')),
          el('td', { class: 'wrap' }, c.lastText.slice(0, 80)),
          el('td', {}, fmt(c.lastActivityAt)),
          el('td', {}, el('button', { class: 'ghost', onclick: () => showConversation(c.id) }, 'ดู')),
        )) : [el('tr', {}, el('td', { colspan: '5', class: 'hint' }, 'ยังไม่มีแชท'))]),
    );
    if (openConv) await showConversation(openConv, true);
  }

  async function showConversation(id, quiet) {
    let data;
    try { data = await api('GET', '/conversations/' + encodeURIComponent(id)); } catch (e) {
      if (e.status === 404) { openConv = null; $('conv-detail').hidden = true; return; }
      throw e;
    }
    openConv = id;
    const c = data.conversation;
    $('conv-detail').hidden = false;
    $('conv-title').textContent = c.handoff ? `พนักงานกำลังดูแลแชทนี้ (${HANDOFF_TH[c.handoffReason] || c.handoffReason})` : 'AI กำลังตอบแชทนี้';
    $('conv-actions').replaceChildren(
      c.handoff
        ? el('button', { onclick: async () => { await api('POST', `/conversations/${encodeURIComponent(id)}/release`); await refreshChat(); } }, 'ให้ AI ตอบต่อ')
        : el('button', { class: 'ghost', onclick: async () => { await api('POST', `/conversations/${encodeURIComponent(id)}/handoff`); await refreshChat(); } }, 'ให้พนักงานตอบเอง'),
      ' ',
      el('button', { class: 'danger', onclick: async () => {
        if (!confirm('ลบแชทนี้ถาวร? (ใช้เมื่อลูกค้าขอลบข้อมูล)')) return;
        await api('DELETE', '/conversations/' + encodeURIComponent(id));
        openConv = null; $('conv-detail').hidden = true; await refreshChat();
      } }, 'ลบแชท'),
    );
    $('conv-messages').replaceChildren(...data.messages.map((m) => msgBubble(m.role, m.text, m.at)));
    if (!quiet) $('conv-detail').scrollIntoView({ behavior: 'smooth' });
  }

  async function loadShopInfo() {
    const { fields, values } = await api('GET', '/shop-info');
    $('shop-info-form').replaceChildren(
      ...Object.entries(fields).map(([k, label]) => el('label', {}, label, el('textarea', { name: k, rows: '2', maxlength: '1000' }))),
      el('div', { class: 'row' }, el('button', { type: 'submit' }, 'บันทึกข้อมูลร้าน'), el('span', { id: 'shop-info-status', class: 'hint' })),
    );
    for (const [k, v] of Object.entries(values)) $('shop-info-form').elements[k].value = v;
  }

  $('shop-info-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const patch = {};
    for (const t of $('shop-info-form').querySelectorAll('textarea')) patch[t.name] = t.value;
    try {
      await api('PUT', '/shop-info', patch);
      $('shop-info-status').textContent = 'บันทึกแล้ว';
    } catch { $('shop-info-status').textContent = 'บันทึกไม่สำเร็จ (ข้อความยาวเกินไป?)'; }
  });

  function resetFaqForm() {
    $('faq-id').value = ''; $('faq-q').value = ''; $('faq-a').value = ''; $('faq-kw').value = '';
    $('faq-submit').textContent = 'เพิ่มคำถาม'; $('faq-cancel').hidden = true;
  }

  async function loadFaq() {
    const { faq } = await api('GET', '/faq');
    $('faq').replaceChildren(
      ...(faq.length ? faq.map((f) => el('tr', {},
        el('td', { class: 'wrap' }, f.question),
        el('td', { class: 'wrap' }, f.answer),
        el('td', { class: 'wrap' }, f.keywords),
        el('td', {},
          el('button', { class: 'ghost', onclick: () => {
            $('faq-id').value = f.id; $('faq-q').value = f.question; $('faq-a').value = f.answer; $('faq-kw').value = f.keywords;
            $('faq-submit').textContent = 'บันทึกการแก้ไข'; $('faq-cancel').hidden = false; $('faq-q').focus();
          } }, 'แก้'), ' ',
          el('button', { class: 'danger', onclick: async () => {
            if (!confirm('ลบคำถามนี้?')) return;
            await api('DELETE', '/faq/' + encodeURIComponent(f.id)); await loadFaq();
          } }, 'ลบ')),
      )) : [el('tr', {}, el('td', { colspan: '4', class: 'hint' }, 'ยังไม่มีคำถาม'))]),
    );
  }

  $('faq-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = { question: $('faq-q').value, answer: $('faq-a').value, keywords: $('faq-kw').value };
    const id = $('faq-id').value;
    try {
      if (id) await api('PUT', '/faq/' + encodeURIComponent(id), body);
      else await api('POST', '/faq', body);
      resetFaqForm();
      await loadFaq();
    } catch { alert('บันทึกไม่สำเร็จ'); }
  });
  $('faq-cancel').addEventListener('click', resetFaqForm);

  $('try-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const text = $('try-text').value.trim();
    if (!text) return;
    $('try-text').value = '';
    $('try-log').append(msgBubble('customer', text));
    try {
      const r = await api('POST', '/chat/try', { text });
      if (r.reply) $('try-log').append(msgBubble('ai', r.reply));
      if (r.handoff) $('try-log').append(msgBubble('system', `ส่งให้พนักงานแล้ว (${HANDOFF_TH[r.handoff] || r.handoff}) AI จะไม่ตอบแชทนี้ต่อ กด "เริ่มใหม่" เพื่อลองใหม่`));
    } catch { $('try-log').append(msgBubble('system', 'ส่งไม่สำเร็จ')); }
    $('try-log').scrollTop = $('try-log').scrollHeight;
  });
  $('try-reset').addEventListener('click', async () => {
    await api('POST', '/chat/try/reset');
    $('try-log').replaceChildren();
  });
  $('conv-handoff-only').addEventListener('change', () => refreshChat().catch(() => {}));

  // ---- A5: คลังรูป + ตัวอย่างภาพโพสต์ ----
  const SOURCE_TH = { real: 'รูปจริงของร้าน', ai: 'รูปจาก AI', template: 'ภาพตกแต่ง' };
  const CONSENT_TH = { not_needed: 'ไม่มีคนในรูป', recorded: 'มีคน · อนุญาตแล้ว', missing: 'มีคน · ยังไม่ได้รับอนุญาต' };
  const ASSET_ERR_TH = {
    too_large: 'ไฟล์ใหญ่เกิน 5 MB', unsupported_type: 'รองรับเฉพาะรูป JPG, PNG, WebP', image_too_small: 'รูปเล็กเกินไป (อย่างน้อย 200×200)',
    image_too_big: 'รูปใหญ่เกินไป', bad_source: 'กรุณาเลือกว่ารูปมาจากไหน', bad_consent: 'กรุณาเลือกว่าในรูปมีคนไหม',
    bad_tags: 'คำค้นยาวหรือเยอะเกินไป', storage_full: 'ที่เก็บรูปเต็ม ลบรูปที่ไม่ใช้ก่อน', file_required: 'กรุณาเลือกรูป',
    consent_missing: 'รูปนี้มีคนแต่ยังไม่ได้รับอนุญาต ใช้ทำโพสต์ไม่ได้', renderer_unavailable: 'ระบบทำภาพยังไม่พร้อม ลองใหม่อีกครั้ง',
    busy: 'กำลังทำภาพอื่นอยู่ รอสักครู่', asset_not_found: 'ไม่พบรูปนี้แล้ว',
  };
  const objectUrls = [];

  async function fetchBlobUrl(path) {
    const res = await fetch('/admin/api' + path, { credentials: 'same-origin', headers: { 'x-hub-admin': '1' } });
    if (!res.ok) throw new Error('load failed');
    const url = URL.createObjectURL(await res.blob());
    objectUrls.push(url);
    return url;
  }

  async function loadAssets() {
    const { assets, usage } = await api('GET', '/assets');
    for (const u of objectUrls.splice(0)) URL.revokeObjectURL(u);
    $('asset-usage').textContent = `${usage.count} รูป · ใช้ไป ${(usage.bytes / 1048576).toFixed(1)} จาก ${Math.round(usage.maxBytes / 1048576)} MB`;
    $('assets').replaceChildren(...(assets.length ? assets.map((a) => {
      const img = el('img', { alt: '' });
      fetchBlobUrl(`/assets/${encodeURIComponent(a.id)}/image`).then((u) => { img.src = u; }).catch(() => {});
      const consentSel = el('select', { onchange: async (ev) => {
        await api('PATCH', '/assets/' + encodeURIComponent(a.id), { consent: ev.target.value });
        await loadAssets();
      } }, ...Object.entries(CONSENT_TH).map(([v, label]) => el('option', { value: v }, label)));
      consentSel.value = a.consent;
      return el('div', { class: 'asset' + (a.usable ? '' : ' locked') },
        img,
        el('div', {}, a.usable ? el('span', { class: 'badge ok' }, 'ใช้ทำโพสต์ได้') : el('span', { class: 'badge bad' }, 'ล็อก: ยังไม่ได้รับอนุญาต')),
        el('div', {}, `${SOURCE_TH[a.source] || a.source} · ${a.width}×${a.height}`),
        a.tags.length ? el('div', { class: 'hint' }, a.tags.join(', ')) : '',
        consentSel,
        el('button', { class: 'danger', onclick: async () => {
          if (!confirm('ลบรูปนี้ถาวร?')) return;
          await api('DELETE', '/assets/' + encodeURIComponent(a.id));
          await loadAssets();
        } }, 'ลบรูป'));
    }) : [el('p', { class: 'hint' }, 'ยังไม่มีรูป')]));

    const sel = $('preview-asset');
    const keep = sel.value;
    sel.replaceChildren(el('option', { value: '' }, 'ไม่ใช้รูป (พื้นสีกรมท่า)'),
      ...assets.filter((a) => a.usable).map((a) => el('option', { value: a.id }, `${SOURCE_TH[a.source]} ${a.width}×${a.height}${a.tags.length ? ' · ' + a.tags.join(', ') : ''}`)));
    sel.value = assets.some((a) => a.id === keep && a.usable) ? keep : '';
  }

  async function loadTemplates() {
    const { templates } = await api('GET', '/content/templates');
    $('preview-template').replaceChildren(...templates.map((t) => el('option', { value: t.id }, t.label)));
  }

  $('asset-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const file = $('asset-file').files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { $('asset-status').textContent = ASSET_ERR_TH.too_large; return; }
    const q = new URLSearchParams({ source: $('asset-source').value, consent: $('asset-consent').value, tags: $('asset-tags').value });
    $('asset-status').textContent = 'กำลังอัปโหลด…';
    const res = await fetch('/admin/api/assets?' + q, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'x-hub-admin': '1', 'content-type': 'application/octet-stream' }, body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { $('asset-status').textContent = 'อัปโหลดไม่สำเร็จ: ' + (ASSET_ERR_TH[data.error] || data.error || res.status); return; }
    $('asset-status').textContent = 'อัปโหลดแล้ว';
    $('asset-form').reset();
    await loadAssets();
  });

  $('preview-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('preview-status').textContent = 'กำลังทำภาพ… (ครั้งแรกอาจใช้เวลาประมาณครึ่งนาที)';
    const body = { templateId: $('preview-template').value };
    if ($('preview-asset').value) body.assetId = $('preview-asset').value;
    const res = await fetch('/admin/api/content/preview', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'x-hub-admin': '1', 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      $('preview-status').textContent = 'ทำภาพไม่สำเร็จ: ' + (ASSET_ERR_TH[data.error] || data.error || res.status);
      return;
    }
    const img = $('preview-img');
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(await res.blob());
    img.hidden = false;
    $('preview-status').textContent = 'ภาพตัวอย่าง 1080×1080 (คลิกขวาที่ภาพเพื่อบันทึกได้)';
  });

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
  setInterval(() => { if (!$('app-view').hidden) { refresh().catch(() => {}); refreshChat().catch(() => {}); } }, 10000);
})();
