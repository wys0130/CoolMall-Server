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
    // 🌟 已删除多余的 templates 表，统一使用 h5_works
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user', vip_expire DATETIME DEFAULT NULL, failed_attempts INTEGER DEFAULT 0, parent_agent_id INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS otp_records (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, code TEXT, expires_at INTEGER, is_used BOOLEAN DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS h5_works (id TEXT PRIMARY KEY, user_id INTEGER, title TEXT DEFAULT '未命名', schema_json TEXT, cover_url TEXT, category TEXT DEFAULT 'h5', is_published INTEGER DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS financial_records (id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT UNIQUE, user_email TEXT, amount REAL, agent_id INTEGER DEFAULT 0, status TEXT DEFAULT 'success', remark TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS system_components (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, icon TEXT, category TEXT, status INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 1)`);
    db.run(`CREATE TABLE IF NOT EXISTS operation_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id TEXT, action TEXT, target_id TEXT, backup_data TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS system_settings (key TEXT UNIQUE, value TEXT)`);

    const defaultAdmin = 'admin@coolmall.com';
    const defaultAdminPwd = hashPassword('admin123456');
    db.get(`SELECT id FROM users WHERE username = ?`, [defaultAdmin], (err, row) => {
        if (!row) db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')`, [defaultAdmin, defaultAdminPwd]);
    });

    const defaultComps = [
        ['表单定制组件', '📝', '基础组件', 1, 1], ['单行文本', '📄', '基础组件', 1, 2], ['文本组件', '📄', '基础组件', 1, 3],
        ['空白组件', '⬜', '基础组件', 1, 4], ['富文本组件', '📰', '基础组件', 1, 5], ['图标组件', '💠', '基础组件', 1, 6],
        ['二维码组件', '🔲', '基础组件', 1, 7], ['表格组件', '📊', '基础组件', 1, 8], ['轮播图组件', '🖼️', '基础组件', 1, 9],
        ['页头组件', '🔝', '基础组件', 1, 10], ['列表组件', '📑', '基础组件', 1, 11], ['通知组件', '📢', '基础组件', 1, 12],
        ['视频组件', '▶️', '媒体组件', 1, 13], ['音频组件', '🎵', '媒体组件', 1, 14], ['图片组件', '📸', '媒体组件', 1, 15],
        ['地图组件', '🗺️', '媒体组件', 1, 16], ['日历组件', '📅', '媒体组件', 1, 17], ['柱状图组件', '📊', '可视化组件', 1, 18],
        ['折线图组件', '📈', '可视化组件', 1, 19], ['饼图组件', '🥧', '可视化组件', 1, 20], ['面积图组件', '📉', '可视化组件', 1, 21],
        ['进度条组件', '🔋', '可视化组件', 1, 22], ['专栏组件', '💎', '营销组件', 1, 23], ['切换页组件', '🔄', '营销组件', 1, 24],
        ['优惠券组件', '🎟️', '营销组件', 1, 25], ['商品标签', '🏷️', '营销组件', 1, 26]
    ];
    defaultComps.forEach(comp => db.run(`INSERT OR IGNORE INTO system_components (name, icon, category, status, sort_order) VALUES (?, ?, ?, ?, ?)`, comp));

    db.get(`SELECT value FROM system_settings WHERE key = 'carousel'`, (err, row) => {
        if (!row) {
            const initCarousel = [{ id: 1, title: '酷猫商业中枢', desc: '海量高质量 H5 落地页，全网一键分发', image_url: '' }, { id: 2, title: '极速生产力引擎', desc: '无需代码，让创意瞬间落地商业化', image_url: '' }];
            db.run(`INSERT INTO system_settings (key, value) VALUES ('carousel', ?)`, [JSON.stringify(initCarousel)]);
        }
    });
    db.get(`SELECT value FROM system_settings WHERE key = 'announcement'`, (err, row) => {
        if (!row) db.run(`INSERT INTO system_settings (key, value) VALUES ('announcement', ?)`, ['🎉 欢迎来到酷猫商业中枢！全新云表格与H5可视化编辑器已全面上线，快来开启您的创意创作吧！']);
    });
});

function verifyPermission(allowedRoles = []) {
    return (req, res, next) => {
        const clientRole = req.headers['x-role'];
        if (!clientRole || !req.headers['x-user-id']) return res.status(401).json({ code: 401, msg: '未登录' });
        if (!allowedRoles.includes(clientRole)) return res.status(403).json({ code: 403, msg: '权限不足' });
        next();
    };
}

app.post('/api/auth/send-code', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ code: 400, msg: '邮箱为空' });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`\n[系统] 验证码已生成 -> 接收人: ${email} | 验证码: ${code}\n`);
    db.run(`INSERT INTO otp_records (email, code, expires_at) VALUES (?, ?, ?)`, [email, code, Date.now() + 300000], () => res.json({ code: 200, msg: `发送成功！(验证码: ${code})` }));
});

app.post('/api/auth/register', (req, res) => {
    const { email, password, verifyCode } = req.body;
    db.get(`SELECT * FROM otp_records WHERE email = ? AND is_used = 0 ORDER BY id DESC LIMIT 1`, [email], (err, record) => {
        if (!record || record.expires_at < Date.now() || record.code !== verifyCode) return res.status(400).json({ code: 400, msg: '验证码失效或错误' });
        db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, 'user')`, [email, hashPassword(password)], function (err) {
            if (err) return res.status(500).json({ code: 500, msg: '账号已存在' });
            db.run(`UPDATE otp_records SET is_used = 1 WHERE id = ?`, [record.id]);
            res.json({ code: 200, msg: '注册成功' });
        });
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err || !user || user.password !== hashPassword(password)) return res.status(401).json({ code: 401, msg: '账号或密码错误' });
        res.json({ code: 200, data: { userId: user.id, username: user.username, role: user.role, vipStatus: user.vip_expire } });
    });
});

// 🌟 干净的唯一保存流，去掉双写表逻辑
app.post('/api/h5/save', verifyPermission(['admin', 'agent', 'vip', 'user']), (req, res) => {
    const { workId, schema, title, cover_url, category, is_published } = req.body;
    if (!Array.isArray(schema)) {
        return res.status(400).json({ code: 400, msg: 'schema必须为数组' });
    }
    const userId = req.headers['x-user-id'];

    db.get('SELECT is_published FROM h5_works WHERE id = ?', [workId], (err, row) => {
        const currentStatus = row ? row.is_published : 0;
        const finalStatus = is_published !== undefined ? is_published : currentStatus;

        const sql = `INSERT INTO h5_works (id, user_id, title, schema_json, cover_url, category, is_published, updated_at) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) 
                     ON CONFLICT(id) DO UPDATE SET schema_json = excluded.schema_json, title = excluded.title, cover_url = excluded.cover_url, category = excluded.category, is_published = excluded.is_published, updated_at = CURRENT_TIMESTAMP`;

        db.run(sql, [workId, userId, title || '未命名', JSON.stringify(schema), cover_url || '', category || 'h5', finalStatus], (err) => {
            if (err) return res.status(500).json({ code: 500, msg: '保存失败' });
            res.json({ code: 200, msg: '保存成功' });
        });
    });
});

app.get('/api/h5/work/:id', (req, res) => {
    db.get(`SELECT * FROM h5_works WHERE id = ?`, [req.params.id], (err, row) => {
        if (!row) return res.status(404).json({ code: 404, msg: '找不到数据' });
        try { row.schema_json = JSON.parse(row.schema_json); } catch (e) { }
        res.json({ code: 200, data: row });
    });
});

app.get('/api/h5/my-works', verifyPermission(['admin', 'agent', 'vip', 'user']), (req, res) => {
    db.all(`SELECT id, title, cover_url, category, is_published, datetime(updated_at, 'localtime') as date FROM h5_works WHERE user_id = ? ORDER BY updated_at DESC`, [req.headers['x-user-id']], (err, rows) => res.json({ code: 200, data: rows }));
});

app.post('/api/h5/work/toggle-publish', verifyPermission(['admin', 'agent', 'vip', 'user']), (req, res) => {
    const role = req.headers['x-role'];
    const userId = req.headers['x-user-id'];
    if (role === 'admin') {
        db.run(`UPDATE h5_works SET is_published = ? WHERE id = ?`, [req.body.is_published, req.body.id], () => res.json({ code: 200, msg: '状态已更新' }));
    } else {
        db.run(`UPDATE h5_works SET is_published = ? WHERE id = ? AND user_id = ?`, [req.body.is_published, req.body.id, userId], () => res.json({ code: 200, msg: '状态已更新' }));
    }
});

app.post('/api/admin/users/grant-vip', verifyPermission(['admin']), (req, res) => {
    const { userId, months } = req.body;
    const expireDate = new Date();
    expireDate.setMonth(expireDate.getMonth() + (months || 1));
    db.run(`UPDATE users SET role = 'vip', vip_expire = ? WHERE id = ?`, [expireDate.toISOString(), userId], (err) => {
        if (err) return res.status(500).json({ code: 500, msg: '授权失败' });
        res.json({ code: 200, msg: 'VIP 权限开通成功！' });
    });
});

app.post('/api/admin/users/add', verifyPermission(['admin']), (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ code: 400, msg: '邮箱和密码不能为空' });
    db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`, [username, hashPassword(password), role || 'user'], (err) => {
        if (err) return res.status(500).json({ code: 500, msg: '该账号已存在或创建失败' });
        res.json({ code: 200, msg: '账号创建成功' });
    });
});

// 🌟 统一大盘拉取接口：只从 h5_works 获取已上架的数据，充当原来的组件模板！
app.get('/api/templates/list', (req, res) => {
    db.all(`SELECT id, title, cover_url, schema_json as json_data, category, datetime(updated_at, 'localtime') as date FROM h5_works WHERE is_published = 1 ORDER BY updated_at DESC`, [], (err, works) => {
        res.json({ code: 200, data: works || [] });
    });
});

app.get('/api/settings/carousel', (req, res) => {
    db.get(`SELECT value FROM system_settings WHERE key = 'carousel'`, (err, row) => res.json({ code: 200, data: row ? JSON.parse(row.value) : [] }));
});

app.get('/api/settings/announcement', (req, res) => {
    db.get(`SELECT value FROM system_settings WHERE key = 'announcement'`, (err, row) => res.json({ code: 200, data: row ? row.value : '' }));
});

app.post('/api/admin/settings/announcement', verifyPermission(['admin']), (req, res) => {
    db.run(`UPDATE system_settings SET value = ? WHERE key = 'announcement'`, [req.body.content], () => res.json({ code: 200, msg: '公告更新成功' }));
});

app.get('/api/admin/users/list', verifyPermission(['admin']), (req, res) => {
    db.all(`SELECT id, username, role, vip_expire, datetime(created_at, 'localtime') as date FROM users ORDER BY id DESC`, [], (err, rows) => res.json({ code: 200, data: rows }));
});

app.get('/api/admin/all-works', verifyPermission(['admin']), (req, res) => {
    db.all(`SELECT id, user_id, title, cover_url, category, is_published, datetime(updated_at, 'localtime') as date FROM h5_works ORDER BY updated_at DESC`, [], (err, rows) => res.json({ code: 200, data: rows }));
});

app.post('/api/admin/force-delete-work', verifyPermission(['admin']), (req, res) => {
    db.get(`SELECT * FROM h5_works WHERE id = ?`, [req.body.id], (err, work) => {
        if (!work) return res.status(404).json({ code: 404, msg: '作品已粉碎' });
        db.run(`INSERT INTO operation_logs (admin_id, action, target_id, backup_data) VALUES (?, ?, ?, ?)`, [req.headers['x-user-id'], 'FORCE_DELETE', req.body.id, JSON.stringify(work)], () => {
            db.run(`DELETE FROM h5_works WHERE id = ?`, [req.body.id], () => res.json({ code: 200, msg: '粉碎成功' }));
        });
    });
});

app.get('/api/admin/operation-logs', verifyPermission(['admin']), (req, res) => {
    db.all(`SELECT * FROM operation_logs ORDER BY id DESC`, [], (err, rows) => res.json({ code: 200, data: rows }));
});

app.get('/api/components/list', (req, res) => {
    db.all(`SELECT * FROM system_components ORDER BY sort_order ASC`, [], (err, rows) => res.json({ code: 200, data: rows }));
});

app.post('/api/admin/components/toggle', verifyPermission(['admin']), (req, res) => {
    const statusVal = req.body.status ? 1 : 0;
    db.run(`UPDATE system_components SET status = ? WHERE id = ?`, [statusVal, req.body.id], (err) => res.json({ code: 200, msg: '设置成功' }));
});

app.post('/api/admin/settings/carousel', verifyPermission(['admin']), (req, res) => {
    db.run(`UPDATE system_settings SET value = ? WHERE key = 'carousel'`, [JSON.stringify(req.body.data)], () => res.json({ code: 200, msg: '主页轮播图更新成功' }));
});

app.post('/api/admin/components/add', verifyPermission(['admin']), (req, res) => {
    const { name, icon, category } = req.body;
    if (!name) return res.status(400).json({ code: 400, msg: '组件名称不能为空' });
    db.run(`INSERT INTO system_components (name, icon, category, status, sort_order) VALUES (?, ?, ?, 1, 99)`, [name, icon || '📦', category || '自定义组件'], function (err) {
        if (err) return res.status(500).json({ code: 500, msg: '已存在' });
        res.json({ code: 200, msg: '下发成功' });
    });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (req.body && req.body.image) {
        const filename = 'cover_' + Date.now() + '.png';
        fs.writeFile(path.join(UPLOAD_DIR, filename), Buffer.from(req.body.image.replace(/^data:image\/\w+;base64,/, ""), 'base64'), () => res.json({ code: 200, url: `http://localhost:3000/uploads/${filename}` }));
        return;
    }
    res.json({ code: 200, url: req.file ? `http://localhost:3000/uploads/${req.file.filename}` : `http://localhost:3000/uploads/default.png` });
});

app.post('/api/render/screenshot', async (req, res) => {
    const { url, pointData } = req.body;
    if (!url) return res.status(400).json({ code: 400, msg: 'URL缺失' });
    let browser;
    try {
        browser = await puppeteer.launch({ headless: "new", executablePath: 'D:\\Tabbit Browser\\Application\\Tabbit Browser.exe', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();

        // 🌟 将窗口强制拉长拉大，方便装下多组件
        await page.setViewport({ width: 375, height: 800 });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
        if (pointData) {
            await page.evaluate((data) => {
                // 🚀 核心修复：彻底清空 localStorage 缓存，防止它被上一张图污染！
                localStorage.clear();
                localStorage.setItem('pointData', JSON.stringify(data));
            }, pointData);
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        const filename = 'screenshot_' + Date.now() + '.png';

        // 🚀 核心修复：开启 fullPage: true 进行长截屏，不切除任何组件
        await page.screenshot({ path: path.join(UPLOAD_DIR, filename), type: 'png', fullPage: true });

        await browser.close();
        res.json({ code: 200, url: `http://localhost:3000/uploads/${filename}` });
    } catch (err) {
        if (browser) await browser.close().catch(() => { });
        res.json({ code: 200, url: 'http://localhost:3000/uploads/default.png', msg: '截图超时' });
    }
});

// 彻底切断无用接口，原 templates/delete 调用重定向至 h5_works
app.post('/api/templates/delete', verifyPermission(['admin', 'agent', 'vip', 'user']), (req, res) => {
    db.run(`DELETE FROM h5_works WHERE id = ?`, [req.body.id], () => res.json({ code: 200, msg: '已删除' }));
});

app.post('/api/admin/operation-logs/delete', verifyPermission(['admin']), (req, res) => {
    const { id } = req.body;
    db.run(`DELETE FROM operation_logs WHERE id = ?`, [id], (err) => {
        if (err) return res.status(500).json({ code: 500, msg: '删除日志失败' });
        res.json({ code: 200, msg: '日志已清除' });
    });
});

app.post('/api/h5/work/delete', verifyPermission(['admin', 'agent', 'vip', 'user']), (req, res) => {
    const role = req.headers['x-role'];
    const userId = req.headers['x-user-id'];
    const { id } = req.body;

    if (!id) return res.status(400).json({ code: 400, msg: '作品 ID 不能为空' });

    if (role === 'admin') {
        db.run(`DELETE FROM h5_works WHERE id = ?`, [id], (err) => {
            if (err) return res.status(500).json({ code: 500, msg: '数据库删除失败' });
            res.json({ code: 200, msg: '作品已成功删除' });
        });
    } else {
        db.run(`DELETE FROM h5_works WHERE id = ? AND user_id = ?`, [id, userId], (err) => {
            if (err) return res.status(500).json({ code: 500, msg: '数据库删除失败' });
            res.json({ code: 200, msg: '作品已成功删除' });
        });
    }
});

app.listen(3000, () => console.log('🚀 酷猫全算力后端引擎平稳运行在 3000 端口'));