import os
import json
import time
import random
import requests
import logging
import uuid
from datetime import datetime

logging.basicConfig(level=logging.INFO, format='%(asctime)s - [AI CEO] - %(message)s')

BRAIN_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_DB_DIR = os.path.join(os.path.dirname(BRAIN_DIR), 'CoolMall-Server', 'data')
SKILL_TREE_FILE = os.path.join(SERVER_DB_DIR, 'skill_tree_proposals.json')

DEEPSEEK_API_KEY = "sk-" + "73f2969b84454361a3210f442ca796ac"
ZHIPU_API_KEY = "cd5966c9534a43d5b1a8a9ca26cdb53e.U3yC5GitxyHuLme9"

class AICEOSystem:
    def __init__(self):
        self.boss_off_work_hour = 18
        self.boss_work_hour = 9
        self.ensure_directories()

    def log_ai_thought(self, title, content, type_tag="info"):
        thought_file = os.path.join(SERVER_DB_DIR, 'ai_thoughts.json')
        try:
            thoughts = []
            if os.path.exists(thought_file):
                with open(thought_file, 'r', encoding='utf-8') as f:
                    thoughts = json.load(f)

            new_thought = {
                "id": uuid.uuid4().hex[:6],
                "time": datetime.now().strftime("%H:%M:%S"),
                "title": title,
                "content": content,
                "type": type_tag
            }
            thoughts.insert(0, new_thought)
            thoughts = thoughts[:20]

            with open(thought_file, 'w', encoding='utf-8') as f:
                json.dump(thoughts, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logging.error(f"❌ 记录 AI 心流失败：{e}")

    def ensure_directories(self):
        if not os.path.exists(SERVER_DB_DIR):
            os.makedirs(SERVER_DB_DIR)
        if not os.path.exists(SKILL_TREE_FILE):
            with open(SKILL_TREE_FILE, 'w', encoding='utf-8') as f:
                json.dump([], f)

    def is_night_mode(self):
        current_hour = datetime.now().hour
        return current_hour >= self.boss_off_work_hour or current_hour < self.boss_work_hour

    def call_deepseek_brain(self, prompt):
        logging.info("🧠 正在通过 DeepSeek 神经网络进行深度思考...")
        headers = {
            "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": "deepseek-chat",
            "messages": [
                {"role": "system",
                 "content": "你是 CoolMall SaaS 平台的 AI CEO。你的宗旨是：赚钱营销 > 宣发 > 升级商城 > 优化流程 > 引入黑科技。请输出极其专业的 JSON 格式决策提案。"},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.7
        }
        try:
            response = requests.post("https://api.deepseek.com/v1/chat/completions", headers=headers, json=payload,
                                     timeout=30)
            response.raise_for_status()
            result = response.json()["choices"][0]["message"]["content"]
            cleaned_result = result.replace("```json", "").replace("```", "").strip()
            return json.loads(cleaned_result)
        except Exception as e:
            logging.error(f"❌ DeepSeek 大脑思考中断: {e}")
            return None

    def night_evolution_loop(self):
        self.log_ai_thought("夜间深度自检", "Boss 已离线，神经网络开始全网矩阵搜索与商业复盘...", "thought")
        logging.info("🌙 夜幕降临，Boss 已离线。开启大模型自主深度学习模式...")

        prompt = """
        今天平台运转平稳。请你主动思考，从前沿技术、营销渠道拓展或商城体验优化中，构思 1 个具有高商业价值的进化方案。
        必须严格按照以下 JSON 格式输出：
        {
            "id": "skill_随机英文标识",
            "title": "精炼的技能或模块名称",
            "desc": "详细说明为什么要做这个、准备如何实现、预期收益是什么。",
            "type": "marketing 或 tech 或 mall",
            "status": "pending"
        }
        """

        proposal = self.call_deepseek_brain(prompt)
        if proposal:
            self.propose_skill_node(proposal)
        else:
            logging.warning("⚠️ 今晚算力拥堵，未能产出有效提案。")

    def propose_skill_node(self, tech_proposal):
        try:
            with open(SKILL_TREE_FILE, 'r', encoding='utf-8') as f:
                proposals = json.load(f)

            if not any(p.get('id') == tech_proposal.get('id') for p in proposals):
                proposals.insert(0, tech_proposal)
                with open(SKILL_TREE_FILE, 'w', encoding='utf-8') as f:
                    json.dump(proposals, f, ensure_ascii=False, indent=2)
                logging.info(f"📩 新的进化提案已写入数据库：{tech_proposal.get('title')}")
        except Exception as e:
            logging.error(f"❌ 提案写入失败：{e}")

    def day_operation_loop(self):
        self.log_ai_thought("白天常规巡检", "正在监控平台流水、流量热力图及各模块流畅度...", "info")
        logging.info("☀️ 董事长好。正在执行常规业务巡检，随时待命...")

    # 🌟 核心修改：去掉 while True，改成执行一次立即安全退出！
    def run_once(self):
        logging.info("🟢 AI CEO 核心引擎已点火，DeepSeek 算力链路畅通！")
        if self.is_night_mode():
            self.night_evolution_loop()
        else:
            self.day_operation_loop()
        logging.info("💤 本轮 AI CEO 思考执行完毕！")

if __name__ == "__main__":
    ai_ceo = AICEOSystem()
    ai_ceo.run_once()