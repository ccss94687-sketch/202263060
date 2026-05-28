let prices = { BTC: 65000.00, ETH: 3500.00 };
let seedMoney = 100000000;
let orders = [];
let currentAsset = 'BTC';

const ASSET_INFO = {
    BTC: { name: 'BTC (Bitcoin)', desc: 'Bitcoin USDT (Binance)' },
    ETH: { name: 'ETH (Ethereum)', desc: 'Ethereum USDT (Binance)' }
};

// --- DOM Elements ---
// Auth
const authOverlay = document.getElementById('auth-overlay');
const appContainer = document.getElementById('app-container');
const adminContainer = document.getElementById('admin-container');
const authUsernameInput = document.getElementById('auth-username');
const authPasswordInput = document.getElementById('auth-password');
const btnLogin = document.getElementById('btn-login');
const btnRegister = document.getElementById('btn-register');
const authError = document.getElementById('auth-error');
const currentUsernameDisplay = document.getElementById('current-username');
const btnLogout = document.getElementById('btn-logout');
const btnAdminLogout = document.getElementById('btn-admin-logout');
const adminUserTbody = document.getElementById('admin-user-tbody');

// Trading
const quantityBuy = document.getElementById('quantity-buy');
const quantitySell = document.getElementById('quantity-sell');
const btnMaxBuy = document.getElementById('btn-max-buy');
const btnMaxSell = document.getElementById('btn-max-sell');
const totalBuyDisplay = document.getElementById('total-buy-display');
const totalSellDisplay = document.getElementById('total-sell-display');
const feeBuyDisplay = document.getElementById('fee-buy-display');
const feeSellDisplay = document.getElementById('fee-sell-display');
const btnBuy = document.getElementById('btn-buy');
const btnSell = document.getElementById('btn-sell');
const orderTbody = document.getElementById('order-tbody');
const assetDisplay = document.getElementById('asset-display');
const cashDisplay = document.getElementById('cash-display');
const plDisplay = document.getElementById('pl-display');
const holdingsDisplay = document.getElementById('holdings-display');
const currentPriceDisplay = document.getElementById('current-price-display');
const currentAssetName = document.getElementById('current-asset-name');
const currentTickerDesc = document.getElementById('current-ticker-desc');
const holdingsLabel = document.getElementById('holdings-label');
const tabBtns = document.querySelectorAll('.tab-btn');

// --- Auth & Fetch Logic ---
let authToken = localStorage.getItem('token');
let currentUsername = localStorage.getItem('username');

async function fetchAuth(url, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const response = await fetch(url, { ...options, headers });
    
    if (response.status === 401 || response.status === 403) {
        logout();
        throw new Error('Unauthorized');
    }
    return response;
}

function showAuth() {
    authOverlay.style.display = 'flex';
    appContainer.style.display = 'none';
    if(adminContainer) adminContainer.style.display = 'none';
    authUsernameInput.value = '';
    authPasswordInput.value = '';
    authError.textContent = '';
}

function hideAuth() {
    authOverlay.style.display = 'none';
    
    if (currentUsername === 'admin') {
        appContainer.style.display = 'none';
        if(adminContainer) adminContainer.style.display = 'block';
        loadAdminDashboard();
        return;
    }
    
    appContainer.style.display = 'block';
    if(adminContainer) adminContainer.style.display = 'none';
    
    currentUsernameDisplay.textContent = currentUsername;
    
    const savedAsset = localStorage.getItem(`lastAsset_${currentUsername}`) || 'BTC';
    currentAsset = savedAsset;
    
    tabBtns.forEach(b => {
        if (b.getAttribute('data-asset') === currentAsset) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });
    
    currentAssetName.textContent = ASSET_INFO[currentAsset].name;
    currentTickerDesc.textContent = ASSET_INFO[currentAsset].desc;
    holdingsLabel.textContent = currentAsset;
    
    fetchState();
    loadTradingViewWidget(currentAsset);
}

function logout() {
    authToken = null;
    currentUsername = null;
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    showAuth();
}

btnRegister.addEventListener('click', async () => {
    const username = authUsernameInput.value;
    const password = authPasswordInput.value;
    if (!username || !password) return authError.textContent = '아이디와 비밀번호를 입력해주세요.';
    
    authError.textContent = '처리 중...';
    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            authError.style.color = 'var(--accent-buy)';
            authError.textContent = '회원가입이 완료되었습니다! 로그인을 진행해주세요.';
        } else {
            authError.style.color = 'var(--accent-sell)';
            authError.textContent = data.error;
        }
    } catch (err) {
        authError.style.color = 'var(--accent-sell)';
        authError.textContent = '서버 오류가 발생했습니다.';
    }
});

btnLogin.addEventListener('click', async () => {
    const username = authUsernameInput.value;
    const password = authPasswordInput.value;
    if (!username || !password) return authError.textContent = '아이디와 비밀번호를 입력해주세요.';
    
    authError.textContent = '로그인 중...';
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            authToken = data.token;
            currentUsername = data.username;
            localStorage.setItem('token', authToken);
            localStorage.setItem('username', currentUsername);
            authError.textContent = '';
            hideAuth();
        } else {
            authError.style.color = 'var(--accent-sell)';
            authError.textContent = data.error;
        }
    } catch (err) {
        authError.style.color = 'var(--accent-sell)';
        authError.textContent = '서버 오류가 발생했습니다.';
    }
});

btnLogout.addEventListener('click', logout);
if (btnAdminLogout) btnAdminLogout.addEventListener('click', logout);

// --- Admin Logic ---
async function loadAdminDashboard() {
    try {
        const res = await fetchAuth('/api/admin/users');
        const users = await res.json();
        
        adminUserTbody.innerHTML = '';
        users.forEach(u => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="text-align:left; font-size:12px; color:var(--text-secondary);">${u.id}</td>
                <td style="text-align:left; font-weight:bold; font-size:16px;">${u.username}</td>
                <td style="color:var(--accent-buy); font-weight:bold;">${formatCurrency(u.totalAsset)}</td>
                <td>${formatCurrency(u.currentCash)}</td>
                <td>
                    <button class="btn btn-sell" style="padding: 6px 12px; font-size: 12px;" onclick="deleteUser('${u.id}', '${u.username}')">계정 삭제</button>
                </td>
            `;
            adminUserTbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Failed to load admin data');
    }
}

window.deleteUser = async function(id, username) {
    if (!confirm(`정말로 유저 [${username}]의 모든 데이터를 삭제하시겠습니까? (복구 불가)`)) return;
    
    try {
        const res = await fetchAuth(`/api/admin/users/${id}`, { method: 'DELETE' });
        if (res.ok) {
            alert(`[${username}] 계정이 완전히 삭제되었습니다.`);
            loadAdminDashboard();
        } else {
            alert('삭제에 실패했습니다.');
        }
    } catch (err) {
        alert('오류가 발생했습니다.');
    }
};

// --- Trading UI Logic ---

tabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        tabBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        
        currentAsset = e.target.getAttribute('data-asset');
        if (currentUsername) {
            localStorage.setItem(`lastAsset_${currentUsername}`, currentAsset);
        }
        
        currentAssetName.textContent = ASSET_INFO[currentAsset].name;
        currentTickerDesc.textContent = ASSET_INFO[currentAsset].desc;
        holdingsLabel.textContent = currentAsset;
        
        updatePriceUI(prices[currentAsset], prices[currentAsset]);
        recalculateTotals();
        renderDashboard();
        
        if (typeof fetchChartData === 'function') fetchChartData();
    });
});

setInterval(async () => {
    if (!authToken) return; // Don't poll if not logged in
    try {
        const res = await fetch('/api/price');
        const data = await res.json();
        let shouldRenderDashboard = false;
        for (const asset in data.prices) {
            const newPrice = data.prices[asset];
            if (newPrice !== prices[asset]) {
                const oldPrice = prices[asset];
                prices[asset] = newPrice;
                if (asset === currentAsset) {
                    updatePriceUI(newPrice, oldPrice);
                    recalculateTotals();
                }
                shouldRenderDashboard = true;
            }
        }
        if (shouldRenderDashboard) renderDashboard();
    } catch (e) {
        console.error('Failed to poll price', e);
    }
}, 4000);

function updatePriceUI(newPrice, oldPrice) {
    currentPriceDisplay.textContent = formatCurrency(newPrice);
    currentPriceDisplay.classList.remove('flash-up', 'flash-down');
    void currentPriceDisplay.offsetWidth;
    
    if (newPrice > oldPrice) {
        currentPriceDisplay.classList.add('flash-up');
    } else if (newPrice < oldPrice) {
        currentPriceDisplay.classList.add('flash-down');
    }
}

function formatCurrency(num) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
}
function formatTime(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleTimeString('en-US', { hour12: false });
}

async function fetchState() {
    try {
        const res = await fetchAuth('/api/state');
        const data = await res.json();
        orders = data.orders;
        seedMoney = data.seedMoney;
        if (data.prices) prices = data.prices;
        
        updatePriceUI(prices[currentAsset], prices[currentAsset]);
        renderDashboard();
        renderOrders();
    } catch (err) {
        // Will be handled by fetchAuth if 401
    }
}

function renderDashboard() {
    let cash = seedMoney;
    let holdings = { BTC: 0, ETH: 0 };
    
    orders.forEach(o => {
        if (o.status === 'cancelled') return;
        const oFee = o.fee || 0;
        if (o.type === 'buy') {
            holdings[o.asset] += o.quantity;
            cash -= (o.totalAmount + oFee);
        } else if (o.type === 'sell') {
            holdings[o.asset] -= o.quantity;
            cash += (o.totalAmount - oFee);
        }
    });

    const btcValue = holdings.BTC * prices.BTC;
    const ethValue = holdings.ETH * prices.ETH;
    const totalValue = cash + btcValue + ethValue;
    const unrealizedPL = totalValue - seedMoney;

    assetDisplay.textContent = formatCurrency(totalValue);
    cashDisplay.textContent = formatCurrency(cash);
    holdingsDisplay.textContent = holdings[currentAsset] || 0; 
    
    plDisplay.textContent = formatCurrency(unrealizedPL);
    if (unrealizedPL > 0) {
        plDisplay.style.color = 'var(--accent-buy)';
        plDisplay.textContent = '+' + formatCurrency(unrealizedPL);
    } else if (unrealizedPL < 0) {
        plDisplay.style.color = 'var(--accent-sell)';
    } else {
        plDisplay.style.color = 'var(--text-primary)';
    }
}

function getHoldings(asset) {
    let count = 0;
    orders.forEach(o => {
        if (o.status === 'cancelled') return;
        if (o.asset === asset) {
            if (o.type === 'buy') count += o.quantity;
            else if (o.type === 'sell') count -= o.quantity;
        }
    });
    return count;
}

function getAvailableCash() {
    let cash = seedMoney;
    orders.forEach(o => {
        if (o.status === 'cancelled') return;
        const oFee = o.fee || 0;
        if (o.type === 'buy') cash -= (o.totalAmount + oFee);
        else if (o.type === 'sell') cash += (o.totalAmount - oFee);
    });
    return cash;
}

btnMaxBuy.addEventListener('click', () => {
    const cash = getAvailableCash();
    const costPerShareWithFee = prices[currentAsset] * 1.0005;
    const maxShares = Math.floor(cash / costPerShareWithFee);
    quantityBuy.value = maxShares > 0 ? maxShares : 0;
    recalculateTotals();
});

btnMaxSell.addEventListener('click', () => {
    const maxShares = getHoldings(currentAsset);
    quantitySell.value = maxShares;
    recalculateTotals();
});

function recalculateTotals() {
    const qtyBuy = Number(quantityBuy.value);
    const qtySell = Number(quantitySell.value);
    
    const totalBuy = qtyBuy * prices[currentAsset];
    const totalSell = qtySell * prices[currentAsset];
    
    totalBuyDisplay.textContent = qtyBuy > 0 ? formatCurrency(totalBuy) : '$0.00';
    totalSellDisplay.textContent = qtySell > 0 ? formatCurrency(totalSell) : '$0.00';
    
    feeBuyDisplay.textContent = qtyBuy > 0 ? formatCurrency(totalBuy * 0.0005) : '$0.00';
    feeSellDisplay.textContent = qtySell > 0 ? formatCurrency(totalSell * 0.0005) : '$0.00';
}

quantityBuy.addEventListener('input', recalculateTotals);
quantitySell.addEventListener('input', recalculateTotals);

function renderOrders() {
    orderTbody.innerHTML = '';
    const sortedOrders = [...orders].sort((a, b) => b.timestamp - a.timestamp);

    sortedOrders.forEach(o => {
        const tr = document.createElement('tr');
        const isCancelled = o.status === 'cancelled';
        const elapsed = Date.now() - o.timestamp;
        const isCancellable = !isCancelled && elapsed <= 2000;
        const remaining = Math.max(0, Math.ceil((2000 - elapsed) / 1000));

        let actionHTML = '';
        if (isCancelled) {
            actionHTML = `<span style="color: var(--text-secondary); font-style: italic;">Cancelled</span>`;
        } else {
            actionHTML = `<button class="btn-cancel" data-id="${o.id}" ${!isCancellable ? 'disabled' : ''}>${isCancellable ? `Cancel (${remaining}s)` : 'Locked'}</button>`;
        }

        tr.innerHTML = `
            <td style="${isCancelled ? 'opacity: 0.5;' : ''}">${formatTime(o.timestamp)}</td>
            <td style="font-weight: 600; ${isCancelled ? 'text-decoration: line-through; opacity: 0.5;' : ''}">${o.asset}</td>
            <td class="type-${o.type}" style="${isCancelled ? 'opacity: 0.5;' : ''}">${o.type.toUpperCase()}</td>
            <td style="${isCancelled ? 'text-decoration: line-through; opacity: 0.5;' : ''}">${o.quantity}</td>
            <td style="${isCancelled ? 'opacity: 0.5;' : ''}">${formatCurrency(o.price)}</td>
            <td style="${isCancelled ? 'text-decoration: line-through; opacity: 0.5;' : ''}">${formatCurrency(o.totalAmount)}<br><small style="color:var(--text-secondary);font-size:11px;">Fee: ${formatCurrency(o.fee || 0)}</small></td>
            <td>${actionHTML}</td>
        `;
        orderTbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-cancel:not(:disabled)').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.target.getAttribute('data-id');
            await cancelOrder(id);
        });
    });
}

async function placeOrder(type) {
    let quantity = type === 'buy' ? Number(quantityBuy.value) : Number(quantitySell.value);
    if (!quantity || quantity <= 0) return alert('올바른 수량을 입력하세요.');

    try {
        const res = await fetchAuth('/api/orders', {
            method: 'POST',
            body: JSON.stringify({ type, quantity, asset: currentAsset })
        });
        
        if (res.ok) {
            if (type === 'buy') quantityBuy.value = '';
            if (type === 'sell') quantitySell.value = '';
            recalculateTotals();
            await fetchState();
        } else {
            const error = await res.json();
            alert('주문 실패: ' + error.error);
        }
    } catch (err) {}
}

btnBuy.addEventListener('click', () => placeOrder('buy'));
btnSell.addEventListener('click', () => placeOrder('sell'));

async function cancelOrder(id) {
    try {
        const res = await fetchAuth(`/api/orders/${id}`, { method: 'DELETE' });
        if (res.ok) {
            await fetchState();
        } else {
            const error = await res.json();
            alert('취소 실패: ' + error.error);
        }
    } catch (err) {}
}

setInterval(() => {
    if (!authToken) return;
    let needsRender = false;
    const now = Date.now();
    
    document.querySelectorAll('.btn-cancel:not(:disabled)').forEach(btn => {
        const id = btn.getAttribute('data-id');
        const order = orders.find(o => o.id === id);
        
        if (order && order.status !== 'cancelled') {
            const elapsed = now - order.timestamp;
            const remaining = Math.max(0, Math.ceil((2000 - elapsed) / 1000));
            
            if (remaining > 0) {
                btn.textContent = `Cancel (${remaining}s)`;
            } else {
                btn.textContent = 'Locked';
                btn.disabled = true;
                needsRender = true; 
            }
        }
    });

    if (needsRender) renderOrders();
}, 1000);


// --- Chart Logic ---
function loadTradingViewWidget(asset) {
    const symbol = asset === 'BTC' ? 'BINANCE:BTCUSDT' : 'BINANCE:ETHUSDT';
    
    if (typeof TradingView === 'undefined') {
        document.getElementById('current-ticker-desc').textContent = 'TradingView script failed to load.';
        return;
    }

    new TradingView.widget({
        "autosize": true,
        "symbol": symbol,
        "interval": "15",
        "timezone": "Etc/UTC",
        "theme": "dark",
        "style": "1",
        "locale": "kr",
        "enable_publishing": false,
        "backgroundColor": "rgba(0, 0, 0, 0)",
        "gridColor": "rgba(43, 49, 57, 0.5)",
        "hide_top_toolbar": false,
        "hide_legend": false,
        "save_image": false,
        "container_id": "tvchart",
        "toolbar_bg": "#141823"
    });
}

window.fetchChartData = function() {
    loadTradingViewWidget(currentAsset);
};

// Application Startup
if (authToken) {
    hideAuth();
} else {
    showAuth();
}
