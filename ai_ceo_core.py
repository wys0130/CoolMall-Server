import os
import json
import time
import random
import requests
import logging
import uuid
from datetime import datetime
import libsql_experimental as libsql

logging.basicConfig(level=logging.INFO, format='%(asctime)s - [AI CEO] - %(message)s')

# 🌟 彻底清除明文 Key，走环境变量，GitHub 扫描绝对不拦截
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
ZHIPU_API_KEY = os.getenv("ZHIPU_API_KEY", "")

class AICEOSystem:
    def __init__(self):
        self.db_url = os.environ.get("TURSO_DB_URL", "")
        self.auth_token = os.environ.get("TURSO_AUTH_TOKEN", "")

    def get_db(self):
        if not self.db_url:
            return None
        return libsql.connect(database=self.db_url, auth_token=self.auth_token)

    def log_ai_thought(self, title, content, type_tag="info"):
        logging.info(f"💡 [AI心流] {title}: {content}")
        conn = self.get_db()
        if not conn: return
        try:
            cursor = conn.cursor()
            cursor.execute("CREATE TABLE IF NOT EXISTS system_settings (key TEXT UNIQUE, value TEXT)")
            cursor.execute("SELECT value FROM system_settings WHERE key = 'ai_thoughts'")
            row = cursor.fetchone()
            thoughts = json.loads(row[0]) if (row and row[0]) else []

            new_thought = {
                "id": uuid.uuid4().hex[:6],
                "time": datetime.now().strftime("%H:%M:%S"),
                "title": title,
                "content": content,
                "type": type_tag
            }
            thoughts.insert(0, new_thought)
            thoughts = thoughts[:15]

            cursor.execute("INSERT INTO system_settings (key, value) VALUES ('ai_thoughts', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (json.dumps(thoughts, ensure_ascii=False),))
            conn.commit()
        except Exception as e:
            logging.error(f"写心流到云端失败: {e}")

    def propose_skill_node(self, proposal):
        conn = self.get_db()
        if not conn: return
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM system_settings WHERE key = 'ai_proposals'")
            row = cursor.fetchone()
            proposals = json.loads(row[0]) if (row and row[0]) else []

            if not any(p.get('id') == proposal.get('id') for p in proposals):
                proposals.insert(0, proposal)
                cursor.execute("INSERT INTO system_settings (key, value) VALUES ('ai_proposals', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (json.dumps(proposals, ensure_ascii=False),))
                conn.commit()
                logging.info("✅ 新进化提案已成功写上云端平台！")
        except Exception as e:
            logging.error(f"写提案失败: {e}")

    def call_deepseek_brain(self, prompt):
        if not DEEPSEEK_API_KEY:
            return None
        headers = {"Authorization": f"Bearer {DEEPSEEK_API_KEY}", "Content-Type": "application/json"}
        payload = {"model": "deepseek-chat", "messages": [{"role": "user", "content": prompt}], "temperature": 0.7}
        try:
            response = requests.post("https://api.deepseek.com/v1/chat/completions", headers=headers, json=payload, timeout=30)
            response.raise_for_status()
            res_str = response.json()["choices"][0]["message"]["content"].replace("```json", "").replace("```", "").strip()
            return json.loads(res_str)
        except Exception:
            return None

    def run_once(self):
        self.log_ai_thought("AI CEO 深度巡检", "正在联网监控高转化海报趋势与商业落地效果...", "thought")
        prompt = """
        今天平台运转平稳。请你主动思考，构思 1 个具有高商业价值的进化方案。输出严格 JSON：
        {"id": "skill_auto_seo", "title": "自动化双语 SEO 洗稿中枢", "desc": "夜间侦测发现海外 Pinterest 对插画类模板流量扶持极大。已编写自动抓取与发帖原型。", "type": "marketing", "status": "pending"}
        """
        proposal = self.call_deepseek_brain(prompt)
        if proposal:
            self.propose_skill_node(proposal)
        self.log_ai_thought("夜间思考完成", "已将最新商业决策推入待批阅技能树，等待站长审批。", "info")

if __name__ == "__main__":
    ai_ceo = AICEOSystem()
    ai_ceo.run_once()