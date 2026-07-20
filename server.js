const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const UPLOAD_DIR = './uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
app.use('/uploads', express.static(UPLOAD_DIR));

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) => cb(null, 'coolmall_' + Date.now() + path.extname(file.originalname))
    }),
    limits: { fileSize: 2 * 1024 * 1024 }
});

const SALT = 'coolmall_security_salt_2026_#@!';
function hashPassword(password) { return crypto.createHash('sha256').update(password + SALT).digest('hex'); }

const db = new sqlite3.Database('./coolmall.db', (err) => {
    if (!err) console.log('📦 酷猫金库挂载成功');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user', vip_expire DATETIME DEFAULT NULL, failed_attempts INTEGER DEFAULT 0, parent_agent_id INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS otp_records (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, code TEXT, expires_at INTEGER, is_used BOOLEAN DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS h5_works (id TEXT PRIMARY KEY, user_id INTEGER, title TEXT DEFAULT '未命名', schema_json TEXT, cover_url TEXT, category TEXT DEFAULT 'h5', is_published INTEGER DEFAULT 1, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS financial_records (id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT UNIQUE, user_email TEXT, amount REAL, agent_id INTEGER DEFAULT 0, status TEXT DEFAULT 'success', remark TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS templates (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, cover_url TEXT NOT NULL, json_data TEXT NOT NULL, category TEXT DEFAULT 'h5', creator_id INTEGER DEFAULT 1, price REAL DEFAULT 0.00, status INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS system_components (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, icon TEXT, category TEXT, status INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 1)`);
    db.run(`CREATE TABLE IF NOT EXISTS operation_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id TEXT, action TEXT, target_id TEXT, backup_data TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

    db.run(`ALTER TABLE h5_works ADD COLUMN cover_url TEXT`, () => { });
    db.run(`ALTER TABLE h5_works ADD COLUMN is_published INTEGER DEFAULT 1`, () => { });
    db.run(`ALTER TABLE h5_works ADD COLUMN category TEXT DEFAULT 'h5'`, () => { });

    const defaultAdmin = 'admin@coolmall.com';
    const defaultAdminPwd = hashPassword('admin123456');
    db.get(`SELECT id FROM users WHERE username = ?`, [defaultAdmin], (err, row) => {
        if (!row) db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')`, [defaultAdmin, defaultAdminPwd]);
    });

    const defaultComps = [
        ['轮播图组件', '🖼️', '基础组件', 1, 1], ['表单组件', '📝', '基础组件', 1, 2],
        ['页头组件', '🔝', '基础组件', 1, 3], ['图文组件', '📰', '基础组件', 1, 4],
        ['视频组件', '▶️', '媒体组件', 1, 5], ['音频组件', '🎵', '媒体组件', 1, 6],
        ['图片组件', '📸', '基础组件', 1, 7], ['列表组件', '📑', '基础组件', 1, 8],
        ['长文本组件', '📄', '基础组件', 1, 9], ['通知组件', '📢', '基础组件', 1, 10]
    ];
    defaultComps.forEach(comp => db.run(`INSERT OR IGNORE INTO system_components (name, icon, category, status, sort_order) VALUES (?, ?, ?, ?, ?)`, comp));
});

function verifyPermission(allowedRoles = []) {
    return (req, res, next) => {
        const clientRole = req.headers['x-role'];
        const clientUser = req.headers['x-user-id'];
        if (!clientRole || !clientUser) return res.status(401).json({ code: 401, msg: '无权操作' });
        if (!allowedRoles.includes(clientRole)) return res.status(403).json({ code: 403, msg: '权限拦截' });
        next();
    };
}

// 💥 修复图1：开发环境将验证码直接返回并打印
app.post('/api/auth/send-code', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ code: 400, msg: '邮箱不能为空' });
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    console.log(`\n================================`);
    console.log(`✉️ 【系统模拟发送邮件】`);
    console.log(`接收人: ${email}`);
    console.log(`验证码: ${code}`);
    console.log(`================================\n`);

    db.run(`INSERT INTO otp_records (email, code, expires_at) VALUES (?, ?, ?)`, [email, code, Date.now() + 5 * 60 * 1000], () => {
        res.json({ code: 200, msg: `发送成功！(开发验证码: ${code})` });
    });
});

app.post('/api/auth/register', (req, res) => {
    const { email, password, verifyCode } = req.body;
    db.get(`SELECT * FROM otp_records WHERE email = ? AND is_used = 0 ORDER BY id DESC LIMIT 1`, [email], (err, record) => {
        if (!record || record.expires_at < Date.now() || record.code !== verifyCode) return res.status(400).json({ code: 400, msg: '验证码失效或错误' });
        db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, 'user')`, [email, hashPassword(password)], function (err) {
            if (err) return res.status(500).json({ code: 500, msg: '写入失败' });
            db.run(`UPDATE otp_records SET is_used = 1 WHERE id = ?`, [record.id]);
            res.json({ code: 200, msg: '注册成功' });
        });
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err || !user || user.password !== hashPassword(password)) return res.status(401).json({ code: 401, msg: '密码错误' });
        res.json({ code: 200, data: { userId: user.id, username: user.username, role: user.role, vipStatus: user.vip_expire } });
    });
});

app.post('/api/h5/save', verifyPermission(['admin', 'agent', 'vip', 'user']), (req, res) => {
    const { workId, schema, title, cover_url, category } = req.body;
    const userId = req.headers['x-user-id'];
    const sql = `INSERT INTO h5_works (id, user_id, title, schema_json, cover_url, category, is_published, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET schema_json = excluded.schema_json, title = excluded.title, cover_url = excluded.cover_url, category = excluded.category, updated_at = CURRENT_TIMESTAMP`;
    db.run(sql, [workId, userId, title || '未命名', JSON.stringify(schema), cover_url || '', category || 'h5'], (err) => {
        if (err) return res.status(500).json({ code: 500, msg: '保存失败' });
        res.json({ code: 200, msg: '保存成功' });
    });
});

app.get('/api/h5/work/:id', (req, res) => {
    db.get(`SELECT * FROM h5_works WHERE id = ?`, [req.params.id], (err, row) => {
        if (err || !row) return res.status(404).json({ code: 404, msg: '找不到数据' });
        try { row.schema_json = JSON.parse(row.schema_json); } catch (e) { }
        res.json({ code: 200, data: row });
    });
});

app.get('/api/h5/my-works', verifyPermission(['admin', 'agent', 'vip', 'user']), (req, res) => {
    db.all(`SELECT id, title, cover_url, category, is_published, datetime(updated_at, 'localtime') as date FROM h5_works WHERE user_id = ? ORDER BY updated_at DESC`, [req.headers['x-user-id']], (err, rows) => res.json({ code: 200, data: rows }));
});

app.post('/api/h5/work/toggle-publish', verifyPermission(['admin', 'agent', 'vip', 'user']), (req, res) => {
    db.run(`UPDATE h5_works SET is_published = ? WHERE id = ?`, [req.body.is_published, req.body.id], (err) => {
        res.json({ code: 200, msg: '状态已更新' });
    });
});

app.get('/api/templates/list', (req, res) => {
    db.all(`SELECT id, title, cover_url, json_data, category, datetime(created_at, 'localtime') as date FROM templates ORDER BY id DESC`, [], (err, tpls) => {
        db.all(`SELECT id, title, cover_url, schema_json as json_data, category, datetime(updated_at, 'localtime') as date FROM h5_works WHERE is_published = 1 ORDER BY updated_at DESC`, [], (err, works) => {
            res.json({ code: 200, data: [...(tpls || []), ...(works || [])] });
        });
    });
});

app.get('/api/admin/all-works', verifyPermission(['admin']), (req, res) => {
    db.all(`SELECT id, user_id, title, cover_url, category, is_published, datetime(updated_at, 'localtime') as date FROM h5_works ORDER BY updated_at DESC`, [], (err, rows) => res.json({ code: 200, data: rows }));
});

app.post('/api/admin/force-delete-work', verifyPermission(['admin']), (req, res) => {
    const { id } = req.body;
    const adminId = req.headers['x-user-id'];
    db.get(`SELECT * FROM h5_works WHERE id = ?`, [id], (err, work) => {
        if (!work) return res.status(404).json({ code: 404, msg: '作品已粉碎' });
        db.run(`INSERT INTO operation_logs (admin_id, action, target_id, backup_data) VALUES (?, ?, ?, ?)`, [adminId, 'FORCE_DELETE', id, JSON.stringify(work)], () => {
            db.run(`DELETE FROM h5_works WHERE id = ?`, [id], (err) => {
                res.json({ code: 200, msg: '彻底粉碎成功' });
            });
        });
    });
});

app.get('/api/admin/operation-logs', verifyPermission(['admin']), (req, res) => {
    db.all(`SELECT * FROM operation_logs ORDER BY id DESC`, [], (err, rows) => res.json({ code: 200, data: rows }));
});

app.get('/api/components/list', (req, res) => {
    db.all(`SELECT * FROM system_components ORDER BY sort_order ASC`, [], (err, rows) => res.json({ code: 200, data: rows }));
});

// 💥 修复图2：提供保存/下发新组件的接口
app.post('/api/admin/components/add', verifyPermission(['admin']), (req, res) => {
    const { name, icon, category } = req.body;
    if (!name) return res.status(400).json({ code: 400, msg: '组件名称不能为空' });

    db.run(`INSERT INTO system_components (name, icon, category, status, sort_order) VALUES (?, ?, ?, 1, 99)`, [name, icon || '📦', category || '自定义组件'], function (err) {
        if (err) return res.status(500).json({ code: 500, msg: '该组件名称可能已存在' });
        res.json({ code: 200, msg: '新组件下发成功！' });
    });
});

app.post('/api/admin/components/toggle', verifyPermission(['admin']), (req, res) => {
    db.run(`UPDATE system_components SET status = ? WHERE id = ?`, [req.body.status ? 1 : 0, req.body.id], (err) => res.json({ code: 200, msg: '设置成功' }));
});

app.post('/api/upload', (req, res) => {
    if (req.body && req.body.image && req.body.image.startsWith('data:image')) {
        const base64Data = req.body.image.replace(/^data:image\/\w+;base64,/, "");
        const filename = 'cover_' + Date.now() + '.png';
        fs.writeFile(path.join(UPLOAD_DIR, filename), Buffer.from(base64Data, 'base64'), () => {
            res.json({ code: 200, data: { url: `http://localhost:3000/uploads/${filename}` } });
        });
        return;
    }
    upload.single('file')(req, res, function (err) {
        if (!req.file) return res.json({ code: 200, data: { url: `http://localhost:3000/uploads/default.png` } });
        res.json({ code: 200, data: { url: `http://localhost:3000/uploads/${req.file.filename}` } });
    });
});

app.post('/api/render/screenshot', async (req, res) => {
    const { url, pointData } = req.body;
    if (!url) return res.status(400).json({ code: 400, msg: 'URL缺失' });
    let browser;
    try {
        browser = await puppeteer.launch({ headless: "new", executablePath: 'D:\\Tabbit Browser\\Application\\Tabbit Browser.exe', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 375, height: 667 });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
        if (pointData) {
            await page.evaluate((data) => { localStorage.setItem('pointData', JSON.stringify(data)); }, pointData);
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        const filename = 'screenshot_' + Date.now() + '.png';
        await page.screenshot({ path: path.join(UPLOAD_DIR, filename), type: 'png' });
        await browser.close();
        res.json({ code: 200, url: `http://localhost:3000/uploads/${filename}` });
    } catch (err) {
        if (browser) await browser.close().catch(() => { });
        res.json({ code: 200, url: 'http://localhost:3000/uploads/default.png', msg: '截图超时' });
    }
});

app.post('/api/templates/delete', (req, res) => {
    db.run(`DELETE FROM templates WHERE id = ?`, [req.body.id], () => res.json({ code: 200, msg: '已删除' }));
});

app.listen(3000, () => console.log('🚀 酷猫全算力后端引擎平稳运行在 3000 端口'));