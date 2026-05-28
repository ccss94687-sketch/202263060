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

// Fetch live prices every 4 seconds from Binance API
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
// Fetch initially and then every 4 seconds
fetchLivePrice();
setInterval(fetchLivePrice, 4000);

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
