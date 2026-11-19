/* 拾味 SAVOUR — 前后端交互逻辑（WorkBuddy Cloud） */
(function () {
  'use strict';

  // publicConfig：来自 workbuddy_cloud_service 的公开配置，可安全放在前端
  var publicConfig = {
    endpoint: 'https://savour-food.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_69oZQ56NKHOO5Y2htAvuHn_54VYSYh5aacDUi6QiwUSoDllrigIKl7Y'
  };

  var cloud = WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: publicConfig.endpoint,
    oauthRelayBaseUrl: publicConfig.oauthRelayBaseUrl,
    publishableKey: publicConfig.publishableKey
  });

  // ---------- 通用 UI 工具 ----------
  var toastEl = document.getElementById('toast');
  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function friendlyError(err) {
    if (!err) return '操作失败，请稍后重试';
    if (err.code === '23505') return '记录已存在';
    if (err.code === '42501' || err.code === '42P01') return '权限或数据表异常，请联系管理员';
    if (err.kind === 'network') return '网络连接失败，请检查网络后重试';
    if (err.kind === 'unauthenticated' || err.kind === 'invalid_grant') return '登录已失效，请重新登录';
    return err.message || '操作失败，请稍后重试';
  }

  // ---------- 会话状态 ----------
  var currentUser = null;
  var favSet = {}; // dish_id -> favorite row id

  function setUser(user) {
    currentUser = user || null;
    var chip = $('userChip');
    var loginBtn = $('navLogin');
    if (currentUser) {
      chip.classList.add('show');
      loginBtn.style.display = 'none';
      var name = currentUser.name || '我的';
      $('userName').textContent = name.length > 6 ? name.slice(0, 6) + '…' : name;
      $('userAva').textContent = (name || '味').charAt(0);
      $('profileSub').textContent = (name ? name + '，' : '') + '你的收藏与订座记录';
    } else {
      chip.classList.remove('show');
      loginBtn.style.display = '';
    }
  }

  // ---------- 菜单（公开读） ----------
  function loadDishes() {
    var grid = $('menuGrid');
    cloud.database.from('dishes').select('*').order('sort_order', { ascending: true })
      .then(function (res) {
        if (res.error) { grid.innerHTML = '<div class="empty">菜单加载失败：' + esc(friendlyError(res.error)) + '</div>'; return; }
        var dishes = res.data || [];
        if (!dishes.length) { grid.innerHTML = '<div class="empty">菜单暂时空空如也</div>'; return; }
        grid.innerHTML = dishes.map(function (d) {
          var faved = favSet[d.id] != null;
          return '<article class="dish">' +
            '<div class="dish-img"><img src="' + esc(d.image) + '" alt="' + esc(d.name) + '" loading="lazy">' +
            (d.tag ? '<span class="tag ' + (d.tag_type === 'green' ? 'green' : '') + '">' + esc(d.tag) + '</span>' : '') + '</div>' +
            '<div class="dish-body"><div class="row"><h3>' + esc(d.name) + '</h3><span class="price">¥' + Number(d.price).toFixed(0) + '<small>/份</small></span></div>' +
            '<p>' + esc(d.description) + '</p><div class="dish-foot">' +
            '<span class="rating">★ ' + Number(d.rating).toFixed(1) + ' <span>' + d.recommend_count + ' 人推荐</span></span>' +
            '<button class="add-btn' + (faved ? ' added' : '') + '" data-dish-id="' + d.id + '" data-dish-name="' + esc(d.name) + '" data-dish-image="' + esc(d.image) + '" title="收藏">' + (faved ? '✓' : '+') + '</button>' +
            '</div></div></article>';
        }).join('');
      });
  }

  // ---------- 评价（公开读） ----------
  function loadReviews() {
    var grid = $('revGrid');
    cloud.database.from('reviews').select('*').order('created_at', { ascending: false }).limit(12)
      .then(function (res) {
        if (res.error) { grid.innerHTML = '<div class="empty">评价加载失败</div>'; return; }
        var list = res.data || [];
        if (!list.length) { grid.innerHTML = '<div class="empty">还没有评价，来发表第一条吧</div>'; return; }
        grid.innerHTML = list.map(function (r) {
          var name = r.owner_name || '食客';
          var stars = '★★★★★'.slice(0, Math.max(1, Math.min(5, r.rating || 5))) + '☆☆☆☆☆'.slice(0, 5 - Math.max(1, Math.min(5, r.rating || 5)));
          var date = r.created_at ? new Date(r.created_at).toLocaleDateString('zh-CN') : '';
          return '<div class="rev"><div class="stars">' + stars + '</div><p>' + esc(r.content) + '</p>' +
            '<div class="who"><div class="avatar">' + esc(name.charAt(0)) + '</div><div><b>' + esc(name) + '</b><span>' + date + '</span></div></div></div>';
        }).join('');
      });
  }

  // ---------- 收藏（登录后 owner-only） ----------
  function loadFavorites() {
    if (!currentUser) { favSet = {}; return Promise.resolve(); }
    return cloud.database.from('favorites').select('id, dish_id, dish_name, dish_image')
      .then(function (res) {
        favSet = {};
        (res.data || []).forEach(function (f) { favSet[f.dish_id] = f; });
      });
  }

  function toggleFavorite(btn) {
    if (!currentUser) { openLogin(); toast('请先登录再收藏'); return; }
    var dishId = Number(btn.getAttribute('data-dish-id'));
    var name = btn.getAttribute('data-dish-name');
    var image = btn.getAttribute('data-dish-image');
    var existing = favSet[dishId];
    if (existing) {
      cloud.database.from('favorites').delete().eq('id', existing.id).select().then(function (res) {
        if (res.error) { toast(friendlyError(res.error)); return; }
        delete favSet[dishId];
        btn.classList.remove('added'); btn.textContent = '+';
        toast('已取消收藏');
      });
    } else {
      cloud.database.from('favorites').insert({ dish_id: dishId, dish_name: name, dish_image: image }).select().then(function (res) {
        if (res.error) { toast(friendlyError(res.error)); return; }
        if (res.data && res.data[0]) favSet[dishId] = res.data[0];
        btn.classList.add('added'); btn.textContent = '✓';
        toast('已加入我的收藏');
      });
    }
  }

  // ---------- 个人中心 ----------
  function renderFavList() {
    var box = $('favList');
    var items = Object.keys(favSet).map(function (k) { return favSet[k]; });
    if (!items.length) { box.innerHTML = '<div class="mini-empty">还没有收藏菜品，点击菜品卡片上的 + 收藏吧</div>'; return; }
    box.innerHTML = items.map(function (f) {
      return '<div class="list-row"><img src="' + esc(f.dish_image) + '" alt=""><div class="grow"><b>' + esc(f.dish_name) + '</b><span>已收藏</span></div>' +
        '<button class="del" data-delfav="' + f.id + '" title="移除">×</button></div>';
    }).join('');
  }

  function renderResList() {
    var box = $('resList');
    cloud.database.from('reservations').select('*').order('created_at', { ascending: false })
      .then(function (res) {
        if (res.error) { box.innerHTML = '<div class="mini-empty">加载失败：' + esc(friendlyError(res.error)) + '</div>'; return; }
        var list = res.data || [];
        if (!list.length) { box.innerHTML = '<div class="mini-empty">还没有订座记录</div>'; return; }
        box.innerHTML = list.map(function (r) {
          return '<div class="list-row"><div class="grow"><b>' + esc(r.reserve_date) + ' ' + esc(r.reserve_time) + ' · ' + esc(r.guests) + ' 位</b>' +
            '<span>' + esc(r.owner_name || r.phone) + (r.note ? ' · ' + esc(r.note) : '') + '</span></div>' +
            '<button class="del" data-delres="' + r.id + '" title="取消">×</button></div>';
        }).join('');
      });
  }

  function openProfile() {
    if (!currentUser) { openLogin(); toast('请先登录'); return; }
    renderFavList(); renderResList();
    $('profileOverlay').classList.add('open');
  }

  // ---------- 登录（手机号 OTP） ----------
  var pendingOtp = null; // { phone, verificationId, isExistingUser }
  var countdownTimer = null;

  function openLogin() { $('loginOverlay').classList.add('open'); $('loginMsg').textContent = ''; }
  function loginMsg(text, cls) { var el = $('loginMsg'); el.textContent = text; el.className = 'msg ' + (cls || ''); }

  function onLoginStateChange(event, session) {
    // SDK 事件回调；会话变化时同步 UI
    if (event === 'SIGNED_OUT') { setUser(null); favSet = {}; loadDishes(); }
  }
  if (cloud.auth && typeof cloud.auth.onAuthStateChange === 'function') {
    cloud.auth.onAuthStateChange(onLoginStateChange);
  }

  function sendCode() {
    var phone = $('loginPhone').value.trim();
    if (!/^1\d{10}$/.test(phone)) { loginMsg('请输入正确的 11 位手机号', 'err'); return; }
    var btn = $('sendCodeBtn');
    btn.disabled = true; btn.textContent = '发送中…';
    loginMsg('');
    cloud.auth.sendOtp({ phone: phone }).then(function (sent) {
      if (sent.error) { loginMsg(friendlyError(sent.error), 'err'); btn.disabled = false; btn.textContent = '获取验证码'; return; }
      pendingOtp = { phone: phone, verificationId: sent.data.verificationId, isExistingUser: sent.data.isExistingUser };
      loginMsg('验证码已发送，请查收短信', 'ok');
      var sec = 60;
      btn.textContent = sec + 's 后重发';
      countdownTimer = setInterval(function () {
        sec--;
        if (sec <= 0) { clearInterval(countdownTimer); btn.disabled = false; btn.textContent = '重新获取'; }
        else btn.textContent = sec + 's 后重发';
      }, 1000);
    });
  }

  function submitLogin() {
    var phone = $('loginPhone').value.trim();
    var code = $('loginCode').value.trim();
    var pending = pendingOtp;
    if (!pending || pending.phone !== phone) { loginMsg('请先获取该手机号的验证码', 'err'); return; }
    if (!code) { loginMsg('请输入验证码', 'err'); return; }
    var btn = $('loginSubmit');
    btn.disabled = true; btn.textContent = '登录中…'; loginMsg('');
    cloud.auth.verifyOtp({
      phone: pending.phone,
      verificationId: pending.verificationId,
      isExistingUser: pending.isExistingUser,
      token: code
    }).then(function (res) {
      btn.disabled = false; btn.textContent = '登录';
      if (res.error) { loginMsg(friendlyError(res.error), 'err'); return; }
      pendingOtp = null;
      setUser(res.data && res.data.user ? res.data.user : { name: '' });
      $('loginOverlay').classList.remove('open');
      $('loginCode').value = '';
      toast('登录成功，欢迎回来');
      loadFavorites().then(function () { loadDishes(); });
    });
  }

  function doLogout() {
    cloud.auth.signOut().then(function () {
      setUser(null); favSet = {};
      $('profileOverlay').classList.remove('open');
      loadDishes();
      toast('已退出登录');
    });
  }

  // ---------- 订座（登录后写） ----------
  function submitReservation(e) {
    e.preventDefault();
    if (!currentUser) { openLogin(); setResMsg('请先登录后再订座', 'err'); return; }
    var phone = $('rPhone').value.trim();
    if (!/^1\d{10}$/.test(phone)) { setResMsg('请输入正确的 11 位手机号', 'err'); return; }
    var payload = {
      owner_name: $('rName').value.trim(),
      phone: phone,
      reserve_date: $('rDate').value,
      reserve_time: $('rTime').value,
      guests: Number($('rGuests').value),
      note: $('rNote').value.trim()
    };
    var btn = $('rSubmit');
    btn.disabled = true; btn.textContent = '提交中…'; setResMsg('');
    cloud.database.from('reservations').insert(payload).select().then(function (res) {
      btn.disabled = false; btn.textContent = '确认订座';
      if (res.error) { setResMsg(friendlyError(res.error), 'err'); return; }
      setResMsg('订座成功！我们已为你预留位置 ✓', 'ok');
      $('reserveForm').reset();
      toast('订座成功');
    });
  }
  function setResMsg(text, cls) { var el = $('rMsg'); el.textContent = text; el.className = 'form-note ' + (cls === 'err' ? 'msg err' : cls === 'ok' ? 'msg ok' : ''); }

  // ---------- 发表评价（登录后写） ----------
  var currentRating = 5;
  function bindStars() {
    var el = $('starInput');
    el.addEventListener('mousemove', function (ev) {
      var r = el.getBoundingClientRect();
      var idx = Math.ceil((ev.clientX - r.left) / (r.width / 5));
      drawStars(Math.max(1, Math.min(5, idx)));
    });
    el.addEventListener('mouseleave', function () { drawStars(currentRating); });
    el.addEventListener('click', function (ev) {
      var r = el.getBoundingClientRect();
      var idx = Math.ceil((ev.clientX - r.left) / (r.width / 5));
      currentRating = Math.max(1, Math.min(5, idx));
      drawStars(currentRating);
    });
  }
  function drawStars(n) { $('starInput').textContent = '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }

  function submitReview() {
    if (!currentUser) { openLogin(); toast('请先登录再发表评价'); return; }
    var text = $('revText').value.trim();
    if (!text) { toast('请先写下你的用餐体验'); return; }
    var name = currentUser.name || '食客';
    cloud.database.from('reviews').insert({ owner_name: name, content: text, rating: currentRating }).select().then(function (res) {
      if (res.error) { toast(friendlyError(res.error)); return; }
      $('revText').value = ''; currentRating = 5; drawStars(5);
      toast('评价已发表，感谢分享');
      loadReviews();
    });
  }

  // ---------- 订阅邮箱（匿名可写） ----------
  function submitSubscribe(e) {
    e.preventDefault();
    var email = $('emailInput').value.trim();
    var btn = $('subBtn');
    btn.disabled = true; btn.textContent = '提交中…';
    cloud.database.from('subscribers').insert({ email: email }).then(function (res) {
      btn.disabled = false; btn.textContent = '立即订阅';
      var msg = $('subMsg');
      if (res.error) {
        if (res.error.code === '23505') { msg.textContent = '这个邮箱已经订阅过啦 😊'; msg.className = 'msg ok reveal'; }
        else { msg.textContent = '订阅失败：' + friendlyError(res.error); msg.className = 'msg err reveal'; }
      } else {
        msg.textContent = '订阅成功，感谢你的关注！美味即将送达 ✨'; msg.className = 'msg ok reveal';
        $('emailInput').value = '';
      }
      setTimeout(function () { msg.textContent = ''; }, 4500);
    });
  }

  // ---------- 事件绑定 ----------
  function bindEvents() {
    $('hamburger').addEventListener('click', function () { $('navLinks').classList.toggle('open'); });
    $('navLinks').querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function () { $('navLinks').classList.remove('open'); });
    });
    $('navLogin').addEventListener('click', function (e) { e.preventDefault(); openLogin(); });
    $('footProfile').addEventListener('click', function (e) { e.preventDefault(); openProfile(); });
    $('userChip').addEventListener('click', openProfile);
    $('sendCodeBtn').addEventListener('click', sendCode);
    $('loginSubmit').addEventListener('click', submitLogin);
    $('logoutBtn').addEventListener('click', doLogout);
    $('reserveForm').addEventListener('submit', submitReservation);
    $('revSubmit').addEventListener('click', submitReview);
    $('subForm').addEventListener('submit', submitSubscribe);
    bindStars();

    document.querySelectorAll('[data-close]').forEach(function (el) {
      el.addEventListener('click', function () { $(el.getAttribute('data-close')).classList.remove('open'); });
    });
    document.querySelectorAll('.overlay').forEach(function (ov) {
      ov.addEventListener('click', function (e) { if (e.target === ov) ov.classList.remove('open'); });
    });

    $('menuGrid').addEventListener('click', function (e) {
      var btn = e.target.closest('.add-btn');
      if (btn) toggleFavorite(btn);
    });
    $('favList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-delfav]');
      if (!btn) return;
      var id = Number(btn.getAttribute('data-delfav'));
      cloud.database.from('favorites').delete().eq('id', id).select().then(function (res) {
        if (res.error) { toast(friendlyError(res.error)); return; }
        Object.keys(favSet).forEach(function (k) { if (favSet[k].id === id) delete favSet[k]; });
        renderFavList(); loadDishes(); toast('已移除收藏');
      });
    });
    $('resList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-delres]');
      if (!btn) return;
      if (!confirm('确定取消这个订座吗？')) return;
      var id = Number(btn.getAttribute('data-delres'));
      cloud.database.from('reservations').delete().eq('id', id).select().then(function (res) {
        if (res.error) { toast(friendlyError(res.error)); return; }
        renderResList(); toast('已取消订座');
      });
    });

    // 导航滚动态 + 高亮
    var nav = $('nav');
    function onScroll() {
      nav.classList.toggle('scrolled', window.scrollY > 60);
      var cur = '';
      document.querySelectorAll('section[id]').forEach(function (s) {
        if (window.scrollY >= s.offsetTop - 120) cur = s.id;
      });
      document.querySelectorAll('.nav-links > a[href^="#"]').forEach(function (l) {
        l.classList.toggle('active', l.getAttribute('href') === '#' + cur);
      });
    }
    window.addEventListener('scroll', onScroll); onScroll();

    // 滚动淡入
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e, i) {
        if (e.isIntersecting) { setTimeout(function () { e.target.classList.add('visible'); }, (i % 3) * 80); observer.unobserve(e.target); }
      });
    }, { threshold: 0.1 });
    document.querySelectorAll('.reveal').forEach(function (el) { observer.observe(el); });
  }

  // ---------- 启动 ----------
  function start() {
    bindEvents();
    // 恢复已有会话；无需登录即可读的公开数据直接加载
    var sessionPromise = (cloud.auth && cloud.auth.getSession) ? cloud.auth.getSession() : Promise.resolve({ data: { session: null }, error: null });
    sessionPromise.then(function (res) {
      var session = res && res.data && (res.data.session || res.data);
      if (session && session.user) setUser(session.user);
      return loadFavorites();
    }).catch(function () { setUser(null); }).then(function () {
      loadDishes();
      loadReviews();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
