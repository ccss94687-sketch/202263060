import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'q-trader-super-secret-key';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// JSON Database Logic
const DB_FILE = path.join(__dirname, 'data.json');

function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], orders: [] }));
    }
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

let prices = { BTC: 65000.00, ETH: 3500.00 };
const INITIAL_SEED_MONEY = 100000000;

// Fetch live prices every 1 second from Binance.US API
async function fetchLivePrice() {
    try {
        const btcRes = await fetch('https://api.binance.us/api/v3/ticker/price?symbol=BTCUSDT');
        const ethRes = await fetch('https://api.binance.us/api/v3/ticker/price?symbol=ETHUSDT');
        
        const btcData = await btcRes.json();
        const ethData = await ethRes.json();
        
        if (btcData.price) prices.BTC = parseFloat(btcData.price);
        if (ethData.price) prices.ETH = parseFloat(ethData.price);
        
        console.log(`[Price Update] BTC: $${prices.BTC} | ETH: $${prices.ETH}`);
    } catch (err) {
        console.error('Failed to fetch live price:', err.message);
    }
}
// Fetch initially and then every 1 second
fetchLivePrice();
setInterval(fetchLivePrice, 1000);

// Auth Middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Forbidden' });
        req.user = user;
        next();
    });
}

// Register
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    
    if (username === 'admin') {
        return res.status(400).json({ error: '관리자 아이디(admin)는 가입할 수 없습니다.' });
    }
    
    const db = readDB();
    if (db.users.find(u => u.username === username)) {
        return res.status(400).json({ error: '이미 존재하는 아이디입니다.' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
        id: uuidv4(),
        username,
        password: hashedPassword,
        seedMoney: INITIAL_SEED_MONEY
    };
    db.users.push(newUser);
    writeDB(db);
    res.status(201).json({ message: 'User registered successfully' });
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (username === 'admin' && password === 'admin') {
        const token = jwt.sign({ id: 'admin-id', username: 'admin', role: 'admin' }, JWT_SECRET);
        return res.json({ token, username: 'admin', role: 'admin' });
    }
    
    const db = readDB();
    const user = db.users.find(u => u.username === username);
    if (!user) return res.status(400).json({ error: '아이디가 존재하지 않습니다.' });
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: '비밀번호가 틀렸습니다.' });
    
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
    res.json({ token, username: user.username });
});

// Get current state
app.get('/api/state', authenticateToken, (req, res) => {
    const db = readDB();
    const user = db.users.find(u => u.id === req.user.id);
    const userOrders = db.orders.filter(o => o.userId === req.user.id);
    res.json({
        orders: userOrders,
        prices: prices,
        seedMoney: user.seedMoney
    });
});

// Get just the live price
app.get('/api/price', (req, res) => {
    res.json({ prices: prices });
});

// Get historical price for a specific asset and date
app.get('/api/historical', async (req, res) => {
    const { asset, date } = req.query;
    if (!asset || !date) {
        return res.status(400).json({ error: 'Asset and date are required' });
    }
    if (!['BTC', 'ETH'].includes(asset)) {
        return res.status(400).json({ error: 'Invalid asset. Must be BTC or ETH' });
    }

    // Validate date format YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    try {
        const symbol = asset === 'ETH' ? 'ETH-USD' : 'BTC-USD';
        const dateParts = date.split('-');
        const selectedDate = new Date(Date.UTC(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2])));
        const start = Math.floor(selectedDate.getTime() / 1000);
        const end = start + (86400 * 5); // 5 days range to ensure we capture the date and weekend etc

        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${start}&period2=${end}&interval=1d`;
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (!response.ok) {
            return res.status(500).json({ error: `Failed to fetch data from Yahoo Finance: ${response.statusText}` });
        }
        
        const data = await response.json();
        const result = data.chart?.result?.[0];
        if (!result || !result.timestamp || !result.indicators?.quote?.[0]?.close) {
            return res.status(404).json({ error: 'No historical data found for this date' });
        }
        
        let closePrice = null;
        let foundDateStr = null;
        
        for (let i = 0; i < result.timestamp.length; i++) {
            const d = new Date(result.timestamp[i] * 1000);
            const yyyy = d.getUTCFullYear();
            const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(d.getUTCDate()).padStart(2, '0');
            const dateStr = `${yyyy}-${mm}-${dd}`;
            
            if (dateStr === date) {
                closePrice = result.indicators.quote[0].close[i];
                foundDateStr = dateStr;
                break;
            }
        }
        
        // If not found exactly, just take the first element (which is the start of the query period)
        if (closePrice === null && result.indicators.quote[0].close.length > 0) {
            closePrice = result.indicators.quote[0].close[0];
            const d = new Date(result.timestamp[0] * 1000);
            const yyyy = d.getUTCFullYear();
            const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(d.getUTCDate()).padStart(2, '0');
            foundDateStr = `${yyyy}-${mm}-${dd}`;
        }
        
        if (closePrice === null || isNaN(closePrice)) {
            return res.status(404).json({ error: 'Close price not found for the requested date range' });
        }
        
        res.json({
            asset: asset,
            requestedDate: date,
            foundDate: foundDateStr,
            closePrice: parseFloat(closePrice.toFixed(2))
        });
    } catch (err) {
        console.error('Error fetching historical price:', err);
        res.status(500).json({ error: 'Internal server error while fetching historical price' });
    }
});

// Create an order
app.post('/api/orders', authenticateToken, (req, res) => {
    const { type, quantity, asset } = req.body;
    const qty = Number(quantity);
    
    if (!type || !qty || qty <= 0 || !asset || !['BTC', 'ETH'].includes(asset)) {
        return res.status(400).json({ error: 'Invalid order parameters' });
    }

    const db = readDB();
    const user = db.users.find(u => u.id === req.user.id);
    const userOrders = db.orders.filter(o => o.userId === req.user.id);

    let currentCash = user.seedMoney;
    let currentHoldings = 0;
    
    for (const o of userOrders) {
        if (o.status === 'cancelled') continue;
        const oFee = o.fee || 0;
        if (o.type === 'buy') {
            currentCash -= (o.totalAmount + oFee);
            if (o.asset === asset) currentHoldings += o.quantity;
        } else if (o.type === 'sell') {
            currentCash += (o.totalAmount - oFee);
            if (o.asset === asset) currentHoldings -= o.quantity;
        }
    }

    const currentPrice = prices[asset];
    const totalAmount = qty * currentPrice;
    const fee = totalAmount * 0.0005; // 0.05% fee

    if (type === 'buy' && currentCash < (totalAmount + fee)) {
        return res.status(400).json({ error: '잔액이 부족합니다. (Insufficient balance, including fee)' });
    }

    if (type === 'sell' && currentHoldings < qty) {
        return res.status(400).json({ error: '보유 수량이 부족합니다. (Insufficient holdings)' });
    }

    const order = {
        id: uuidv4(),
        userId: req.user.id,
        type: type,
        asset: asset,
        quantity: qty,
        price: currentPrice,
        totalAmount: totalAmount,
        fee: fee,
        status: 'active',
        timestamp: Date.now()
    };

    db.orders.push(order);
    writeDB(db);
    res.status(201).json(order);
});

// Cancel an order
app.delete('/api/orders/:id', authenticateToken, (req, res) => {
    const { id } = req.params;
    const db = readDB();
    const index = db.orders.findIndex(o => o.id === id && o.userId === req.user.id);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Order not found' });
    }

    const order = db.orders[index];
    if (order.status === 'cancelled') {
        return res.status(400).json({ error: 'Order already cancelled' });
    }

    if (Date.now() - order.timestamp > 2000) {
        return res.status(400).json({ error: 'Cancellation window expired (2 seconds limit)' });
    }

    db.orders[index].status = 'cancelled';
    writeDB(db);
    res.json({ message: 'Order cancelled successfully', order: db.orders[index] });
});

// Admin API
app.get('/api/admin/users', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const db = readDB();
    const users = db.users.map(u => {
        let cash = u.seedMoney;
        let holdings = { BTC: 0, ETH: 0 };
        const userOrders = db.orders.filter(o => o.userId === u.id && o.status !== 'cancelled');
        
        for (const o of userOrders) {
            const fee = o.fee || 0;
            if (o.type === 'buy') {
                cash -= (o.totalAmount + fee);
                holdings[o.asset] = (holdings[o.asset] || 0) + o.quantity;
            } else if (o.type === 'sell') {
                cash += (o.totalAmount - fee);
                holdings[o.asset] = (holdings[o.asset] || 0) - o.quantity;
            }
        }
        
        let totalAsset = cash;
        for (const asset in holdings) {
            if (prices[asset]) {
                totalAsset += holdings[asset] * prices[asset];
            }
        }
        
        return { 
            id: u.id, 
            username: u.username, 
            seedMoney: u.seedMoney, 
            currentCash: cash,
            totalAsset: totalAsset
        };
    });
    res.json(users);
});

app.delete('/api/admin/users/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const db = readDB();
    const userId = req.params.id;
    
    db.users = db.users.filter(u => u.id !== userId);
    db.orders = db.orders.filter(o => o.userId !== userId);
    
    writeDB(db);
    res.json({ message: 'User deleted successfully' });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
