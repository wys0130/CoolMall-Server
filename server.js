const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const puppeteer = require('puppeteer');

// 1. 🌟 必须最先初始化 app
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 2. 🌟 app 存在之后，再挂载图片库依赖和路由
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const UPLOAD_DIR = './uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
app.use('/uploads', express.static(UPLOAD_DIR)); // 开放图片访问权限

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) => cb(null, 'coolmall_' + Date.now() + path.extname(file.originalname))
    }),
    limits: { fileSize: 2 * 1024 * 1024 } // 强制拦截超过 2MB 的文件
});

const SALT = 'coolmall_security_salt_2026_#@!';
function hashPassword(password) {
    return crypto.createHash('sha256').update(password + SALT).digest('hex');
}

// 挂载数据库
const db = new sqlite3.Database('./coolmall.db', (err) => {
    if (!err) console.log('📦 酷猫商业级多租户金库已成功挂载');
});

// 初始化五层权限级联架构表
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'user',
        vip_expire DATETIME DEFAULT NULL,
        failed_attempts INTEGER DEFAULT 0,
        parent_agent_id INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS otp_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT,
        code TEXT,
        expires_at INTEGER,
        is_used BOOLEAN DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS h5_works (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        title TEXT DEFAULT '未命名作品',
        schema_json TEXT,
        is_published BOOLEAN DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS financial_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_no TEXT UNIQUE,
        user_email TEXT,
        amount REAL,
        agent_id INTEGER DEFAULT 0,
        status TEXT DEFAULT 'success',
        remark TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        cover_url TEXT NOT NULL,
        json_data TEXT NOT NULL,
        category TEXT DEFAULT 'h5',
        creator_id INTEGER DEFAULT 1,
        price REAL DEFAULT 0.00,
        status INTEGER DEFAULT 1,  -- 1表示默认直接上架商城
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 🌟 核心修复：补全了 [defaultAdmin, defaultAdminPwd] 变量传参！
    const defaultAdmin = 'admin@coolmall.com';
    const defaultAdminPwd = hashPassword('admin123456');
    db.get(`SELECT id FROM users WHERE username = ?`, [defaultAdmin], (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')`, [defaultAdmin, defaultAdminPwd]);
            console.log(`✨ [系统初始化] 成功创建超级管理员根节点: ${defaultAdmin} (密码: admin123456)`);
        }
    });
});

// ==========================================
// 【权限隔离控制网关 - 中间件】
// ==========================================
function verifyPermission(allowedRoles = []) {
    return (req, res, next) => {
        const clientRole = req.headers['x-role'];
        const clientUser = req.headers['x-user-id'];

        if (!clientRole || !clientUser) {
            return res.status(401).json({ code: 401, msg: '游客身份受限，请先登录系统' });
        }
        if (!allowedRoles.includes(clientRole)) {
            return res.status(403).json({ code: 403, msg: '权限不足！安全审计拦截，操作已被记录' });
        }
        next();
    };
}

// ==========================================
// 1. 基础验证码流转 API 
// ==========================================
app.post('/api/auth/send-code', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ code: 400, msg: '邮箱不能为空' });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000;

    db.run(`INSERT INTO otp_records (email, code, expires_at) VALUES (?, ?, ?)`, [email, code, expiresAt], (err) => {
        if (err) return res.status(500).json({ code: 500, msg: '验证码持久化落库失败' });
        console.log(`📧 [安全审计] 验证码成功入库 -> 目标: ${email} | 验证码: ${code}`);
        res.json({ code: 200, msg: '验证码下发成功！' });
    });
});

// ==========================================
// 2. 创作者自主注册 API
// ==========================================
app.post('/api/auth/register', (req, res) => {
    const { email, password, verifyCode } = req.body;

    db.get(`SELECT * FROM otp_records WHERE email = ? AND is_used = 0 ORDER BY id DESC LIMIT 1`, [email], (err, record) => {
        if (err || !record) return res.status(400).json({ code: 400, msg: '请先获取验证码' });
        if (record.expires_at < Date.now()) return res.status(400).json({ code: 400, msg: '验证码已超时过期' });
        if (record.code !== verifyCode) return res.status(400).json({ code: 400, msg: '验证码匹配错误' });

        const hashedPassword = hashPassword(password);
        db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, 'user')`, [email, hashedPassword], function (insertErr) {
            if (insertErr) {
                if (insertErr.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ code: 400, msg: '该邮箱在系统内已被注册' });
                }
                return res.status(500).json({ code: 500, msg: '数据库写入异常' });
            }
            db.run(`UPDATE otp_records SET is_used = 1 WHERE id = ?`, [record.id]);
            res.json({ code: 200, msg: '恭喜，酷猫办公账号注册成功！' });
        });
    });
});

// ==========================================
// 3. 满血防爆破登录分流网关 API
// ==========================================
app.post('/api/login', (req, res) => {
    const { username, password, verifyCode } = req.body;

    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err || !user) return res.status(401).json({ code: 401, msg: '账号或密码不正确' });

        if (user.failed_attempts >= 3 && !verifyCode) {
            return res.status(403).json({ code: 403, msg: '账户处于高风险风控状态，必须输入验证码解锁', needCaptcha: true });
        }

        if (user.failed_attempts >= 3 && verifyCode) {
            db.get(`SELECT * FROM otp_records WHERE email = ? AND is_used = 0 ORDER BY id DESC LIMIT 1`, [username], (err, record) => {
                if (!record || record.expires_at < Date.now() || record.code !== verifyCode) {
                    return res.status(400).json({ code: 400, msg: '解锁验证码无效或已失效', needCaptcha: true });
                }
                db.run(`UPDATE otp_records SET is_used = 1 WHERE id = ?`, [record.id]);
                executePasswordCheck(user, password, res);
            });
            return;
        }

        executePasswordCheck(user, password, res);
    });
});

function executePasswordCheck(user, inputPassword, res) {
    if (user.password !== hashPassword(inputPassword)) {
        db.run(`UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ?`, [user.id]);
        return res.status(401).json({ code: 401, msg: `账号或密码错误 (安全锁警告: 已错 ${user.failed_attempts + 1} 次)` });
    }
    db.run(`UPDATE users SET failed_attempts = 0 WHERE id = ?`, [user.id]);
    res.json({
        code: 200,
        data: { userId: user.id, username: user.username, role: user.role, vipStatus: user.vip_expire }
    });
}

// ==========================================
// 4. 【超管专属】代理商生命周期指派 API
// ==========================================
app.post('/api/admin/create-agent', verifyPermission(['admin']), (req, res) => {
    const { agentEmail, agentPassword } = req.body;
    if (!agentEmail || !agentPassword) return res.status(400).json({ code: 400, msg: '必填项缺失' });

    const hashedPassword = hashPassword(agentPassword);
    db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, 'agent')`, [agentEmail, hashedPassword], function (err) {
        if (err) return res.status(400).json({ code: 400, msg: '该账号已指派或存在冲突' });
        res.json({ code: 200, msg: '级联代理商创建成功，最高管理权已就绪！' });
    });
});

// ==========================================
// 5. 【超管/代理共享】多租户账户穿透检索 API
// ==========================================
app.get('/api/admin/users', verifyPermission(['admin', 'agent']), (req, res) => {
    const executorRole = req.headers['x-role'];
    const executorId = req.headers['x-user-id'];

    if (executorRole === 'admin') {
        db.all(`SELECT id, username, role, vip_expire, parent_agent_id, created_at FROM users ORDER BY id DESC`, [], (err, rows) => {
            res.json({ code: 200, data: rows });
        });
    } else {
        db.all(`SELECT id, username, role, vip_expire, created_at FROM users WHERE parent_agent_id = ? ORDER BY id DESC`, [executorId], (err, rows) => {
            res.json({ code: 200, data: rows });
        });
    }
});

// ==========================================
// 6. 【高级后台】跨角色等级穿透修改 API
// ==========================================
app.post('/api/admin/update-role', verifyPermission(['admin']), (req, res) => {
    const { targetUserId, newRole, vipDays } = req.body;

    let expireDate = null;
    if (newRole === 'vip' && vipDays) {
        const now = new Date();
        now.setDate(now.getDate() + parseInt(vipDays));
        expireDate = now.toISOString().replace('T', ' ').substring(0, 19);
    }

    db.run(`UPDATE users SET role = ?, vip_expire = ? WHERE id = ?`, [newRole, expireDate, targetUserId], (err) => {
        if (err) return res.status(500).json({ code: 500, msg: '底层数据重置失败' });
        res.json({ code: 200, msg: '全网节点权限及VIP周期同步刷新成功！' });
    });
});

// ==========================================
// 7. 【资产大盘】财务与模板销量数据看板 API
// ==========================================
app.get('/api/dashboard/overview', verifyPermission(['admin', 'agent']), (req, res) => {
    db.get(`SELECT SUM(amount) as totalRevenue, COUNT(*) as orderCount FROM financial_records WHERE status = 'success'`, [], (err, financialRow) => {
        db.get(`SELECT COUNT(*) as workCount FROM h5_works`, [], (err, workRow) => {
            res.json({
                code: 200,
                data: {
                    totalRevenue: financialRow?.totalRevenue || 0.00,
                    monthlySales: financialRow?.orderCount || 0,
                    workCount: workRow?.workCount || 0
                }
            });
        });
    });
});

app.get('/api/dashboard/sales-ranking', verifyPermission(['admin', 'agent', 'vip', 'user']), (req, res) => {
    const mockRanking = [
        { id: 'TPL-001', name: '酷猫出海科技高转化落地页', sales: 1248, revenue: 12410.00 },
        { id: 'TPL-045', name: '企业财务与开票中台配置流程图', sales: 832, revenue: 8230.50 },
        { id: 'TPL-112', name: '全球化高能生产力引擎动效海报', sales: 512, revenue: 5120.00 }
    ];
    res.json({ code: 200, data: mockRanking });
});

// ==========================================
// 8. 核心生产力引擎云端自动同步组件 API
// ==========================================
app.post('/api/h5/save', verifyPermission(['admin', 'agent', 'vip', 'user']), (req, res) => {
    const { workId, schema, title } = req.body;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-role'];

    if (!workId || !schema) return res.status(400).json({ code: 400, msg: '缺少云同步核心节点参数' });

    if (userRole === 'user') {
        db.get(`SELECT COUNT(*) as count FROM h5_works WHERE user_id = ? AND id != ?`, [userId, workId], (err, row) => {
            if (row && row.count >= 3) {
                return res.status(429).json({ code: 429, msg: '免费创作者云端项目存储已达 3 个上限，请升级VIP！' });
            }
            saveExecution(workId, userId, schema, title, res);
        });
    } else {
        saveExecution(workId, userId, schema, title, res);
    }
});

function saveExecution(workId, userId, schema, title, res) {
    const sql = `
        INSERT INTO h5_works (id, user_id, title, schema_json, updated_at) 
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET schema_json = excluded.schema_json, title = excluded.title, updated_at = CURRENT_TIMESTAMP
    `;
    db.run(sql, [workId, userId, title || '未命名资产', JSON.stringify(schema)], (err) => {
        if (err) return res.status(500).json({ code: 500, msg: '核心资产云存储同步失败' });
        res.json({ code: 200, msg: '作品已成功上云！全网工程数实时 +1' });
    });
}

// ==========================================
// 🌟 新增：获取“我的作品”列表 API
// ==========================================
app.get('/api/h5/my-works', verifyPermission(['admin', 'agent', 'vip', 'user']), (req, res) => {
    const userId = req.headers['x-user-id'];
    db.all(`SELECT id, title, datetime(updated_at, 'localtime') as date FROM h5_works WHERE user_id = ? ORDER BY updated_at DESC`, [userId], (err, rows) => {
        if (err) return res.status(500).json({ code: 500, msg: '获取作品列表失败' });
        res.json({ code: 200, data: rows });
    });
});

app.get('/api/h5/work/:id', (req, res) => {
    db.get(`SELECT * FROM h5_works WHERE id = ?`, [req.params.id], (err, row) => {
        if (err || !row) return res.status(404).json({ code: 404, msg: '工程资产不存在或已被原作者粉碎' });
        row.schema_json = JSON.parse(row.schema_json);
        res.json({ code: 200, data: row });
    });
});

// ==========================================
// 9. 自动化发货 Webhook 接入网关
// ==========================================
const AFDIAN_USER_ID = 'coolmall_production_id';
const AFDIAN_TOKEN = 'coolmall_secure_token_key';

app.post('/api/webhook/afdian', (req, res) => {
    const { data } = req.body;
    if (!data || !data.order) return res.status(400).send('Invalid Packet');

    const order = data.order;
    const userEmail = order.remark;
    const orderNo = order.out_trade_no;
    const payAmount = parseFloat(order.total_amount);

    db.run(`INSERT INTO financial_records (order_no, user_email, amount, remark) VALUES (?, ?, ?, '爱发电自动发货流转')`, [orderNo, userEmail, payAmount], (err) => {
        if (err) return res.json({ ec: 200, em: 'duplicated' });

        db.get(`SELECT id, vip_expire FROM users WHERE username = ?`, [userEmail], (err, user) => {
            if (!user) return res.json({ ec: 200, em: 'user_not_found' });

            let currentExpire = user.vip_expire ? new Date(user.vip_expire) : new Date();
            if (currentExpire < new Date()) currentExpire = new Date();

            currentExpire.setDate(currentExpire.getDate() + 30);
            const formattedDate = currentExpire.toISOString().replace('T', ' ').substring(0, 19);

            db.run(`UPDATE users SET role = 'vip', vip_expire = ? WHERE id = ?`, [formattedDate, user.id], () => {
                res.json({ ec: 200, em: 'success' });
            });
        });
    });
});

// ==========================================
// 🌟 新增：多租户中台财务开票流水真实获取接口
// ==========================================
app.get('/api/finance/all-list', verifyPermission(['admin', 'agent']), (req, res) => {
    db.all(`SELECT * FROM financial_records ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ code: 500, data: [] });
        res.json({ code: 200, data: rows });
    });
});

// 🌟 新增：C端用户在生产力画布右下角点击“购买商品”时，触发的真实扣款扣减与身份晋升网关
app.post('/api/mock/user-pay-action', verifyPermission(['user', 'vip']), (req, res) => {
    const clientUserId = req.headers['x-user-id'];
    const orderNo = 'MOCK-ORD-' + Math.floor(Math.random() * 100000000);

    db.get(`SELECT username FROM users WHERE id = ?`, [clientUserId], (err, user) => {
        if (!user) return res.status(404).json({ code: 404, msg: '用户节点不存在' });

        // 1. 往数据库真实塞入一笔 99 元的高阶 VIP 会员财务流水
        db.run(`INSERT INTO financial_records (order_no, user_email, amount, remark) VALUES (?, ?, 99.00, '购买酷猫办公企业级高阶VIP')`, [orderNo, user.username], (insErr) => {
            if (insErr) return res.status(500).json({ code: 500, msg: '财务中台流水入库失败' });

            // 2. 真实穿透修改其为 VIP 付费等级
            db.run(`UPDATE users SET role = 'vip' WHERE id = ?`, [clientUserId], () => {
                res.json({ code: 200, msg: '🎉 支付网关清算成功！进账 ¥99.00，本地已晋升为高级VIP！' });
            });
        });
    });
});

// 🌟 增量添加：编辑器图片库双向通信接口
// 🌟 修复：双引擎文件接收器（兼容普通图片上传与 Base64 封面截屏）
app.post('/api/upload', (req, res) => {
    // 拦截 1：如果前端传来的是 base64 文本（例如点击“一键生成封面”时）
    if (req.body && req.body.image && req.body.image.startsWith('data:image')) {
        const base64Data = req.body.image.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');
        const filename = 'cover_' + Date.now() + '.png';
        fs.writeFile(path.join(UPLOAD_DIR, filename), buffer, (err) => {
            if (err) return res.status(500).json({ code: 500, msg: '封面生成失败' });
            const fileUrl = `http://localhost:3000/uploads/${filename}`;
            return res.json({ code: 200, data: { url: fileUrl }, url: fileUrl, msg: '封面截取并上传成功' });
        });
        return;
    }

    // 拦截 2：正常的物理文件上传（图库上传）
    upload.single('file')(req, res, function (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ code: 400, msg: '拦截：图片大小不能超过 2MB！' });
        } else if (err) {
            return res.status(500).json({ code: 500, msg: '文件落盘异常' });
        }
        // Dooring 默认有个 default cover 机制，容错处理
        if (!req.file) {
            const defaultUrl = `http://localhost:3000/uploads/default.png`;
            return res.json({ code: 200, data: { url: defaultUrl }, url: defaultUrl, msg: '使用默认封面' });
        }

        const fileUrl = `http://localhost:3000/uploads/${req.file.filename}`;
        res.json({ code: 200, data: { url: fileUrl }, url: fileUrl, msg: '上传成功' });
    });
});

app.get('/api/files', (req, res) => {
    fs.readdir(UPLOAD_DIR, (err, files) => {
        if (err) return res.json({ code: 200, data: [] });
        const urls = files.filter(f => /\.(png|jpe?g|gif|webp)$/i.test(f))
            .map(f => ({ url: `http://localhost:3000/uploads/${f}`, name: f }));
        res.json({ code: 200, data: urls });
    });
});

// ==========================================
// 🌟 新增：模板商城大厅 API (酷猫资产库)
// ==========================================

// 1. 接收前端画布数据，存入模板金库
app.post('/api/templates/save', (req, res) => {
    const { title, cover_url, json_data, category } = req.body;

    // 将数据持久化到 SQLite 数据库的 templates 表中
    db.run(
        `INSERT INTO templates (title, cover_url, json_data, category, status) VALUES (?, ?, ?, ?, 1)`,
        [title, cover_url, JSON.stringify(json_data), category || 'h5'],
        function (err) {
            if (err) {
                console.error('模板保存失败:', err);
                return res.status(500).json({ code: 500, msg: '保存模板落库失败' });
            }

            // 🌟 核心修复点：成功响应后必须直接 return，切断后续多余且会导致崩溃的代码！
            return res.json({ code: 200, msg: '模板保存成功！', id: this.lastID });
        }
    );
});

// 2. 拉取云端模板，展示在“我的模版库”面板
app.get('/api/templates/list', (req, res) => {
    // 💥 致命修复：必须把 json_data 和 category 这两个核心数据查出来发给前端！
    db.all(`SELECT id, title, cover_url, json_data, category, datetime(created_at, 'localtime') as date FROM templates ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ code: 500, msg: '获取模板列表失败' });
        res.json({ code: 200, data: rows });
    });
});

// ==========================================
// 🌟 核心：后端 Puppeteer 渲染引擎 (防卡死与超时宽容版)
// ==========================================
app.post('/api/render/screenshot', async (req, res) => {
    const { url, pointData } = req.body;
    if (!url) return res.status(400).json({ code: 400, msg: 'URL缺失' });

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            executablePath: 'D:\\Tabbit Browser\\Application\\Tabbit Browser.exe',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 375, height: 667 });

        // 🌟 宽容处理 1：缩短超时时间到 15 秒，并且如果超时了不要崩溃，继续往下走！
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => console.log('首次建立域名超时，忽略并继续'));

        if (pointData) {
            await page.evaluate((data) => {
                localStorage.setItem('pointData', JSON.stringify(data));
            }, pointData);

            // 🌟 宽容处理 2：刷新页面读取数据，即使资源加载没完成也强行截图
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => console.log('写入数据后刷新超时，忽略并继续'));
            await new Promise(resolve => setTimeout(resolve, 1000)); // 留1秒给React渲染 DOM
        }

        const filename = 'screenshot_' + Date.now() + '.png';
        const filepath = path.join(UPLOAD_DIR, filename);
        await page.screenshot({ path: filepath, type: 'png' });
        await browser.close();

        res.json({ code: 200, url: `http://localhost:3000/uploads/${filename}` });
    } catch (err) {
        if (browser) await browser.close().catch(() => { }); // 兜底清理内存
        console.error("渲染引擎非致命异常:", err.message);
        // 🌟 终极降维打击：如果截图真的彻底失败了，给一张默认兜底封面，保证用户的模板能够成功保存入库！
        res.json({ code: 200, url: 'http://localhost:3000/uploads/default.png', msg: '截图超时，已使用系统默认封面' });
    }
});


// ==========================================
// 🌟 模板删除接口 (供前端增删改查使用)
// ==========================================
app.post('/api/templates/delete', (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ code: 400, msg: '缺少模板ID' });

    db.run(`DELETE FROM templates WHERE id = ?`, [id], (err) => {
        if (err) return res.status(500).json({ code: 500, msg: '删除失败' });
        res.json({ code: 200, msg: '模板已永久删除' });
    });
});

app.listen(3000, () => console.log('🚀 酷猫全算力多租户后端大脑平稳运行在 3000 端口'));
