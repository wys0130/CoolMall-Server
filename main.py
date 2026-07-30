import os
import json
import time
import uuid
import random
import requests
import logging
import base64
import socket
from io import BytesIO
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
except ImportError:
    print("❌ 缺少 Pillow 库，请在终端运行: pip install Pillow")
    exit(1)

import libsql_experimental as libsql

socket.setdefaulttimeout(25)

# ========== 1. 基础配置 & 字体基因库 ==========
console_handler = logging.StreamHandler()
console_handler.setFormatter(logging.Formatter('%(message)s'))
logging.basicConfig(level=logging.INFO, handlers=[console_handler])

proxies = {
    "http": None,
    "https": None,
}

DIRECT_HOSTS = ['open.bigmodel.cn', 'api.deepseek.com', 'localhost', '127.0.0.1', 'zhihu.com', 'baidu.com']


class DomainRouter(HTTPAdapter):
    def send(self, request, **kwargs):
        kwargs['proxies'] = proxies
        return super().send(request, **kwargs)


session = requests.Session()
session.mount('https://', DomainRouter())
session.mount('http://', DomainRouter())


def uuid_hex():
    return uuid.uuid4().hex[:6]


FONT_CATALOG = {
    "tech": ["zcool-gdh.ttf", "FZCuHei-B03S.ttf", "msyhbd.ttc", "simhei.ttf"],
    "bold": ["zcoolkuaile.ttf", "zihun59.ttf", "msyhbd.ttc", "simhei.ttf"],
    "calligraphy": ["yuweishufa.ttf", "zihun24.ttf", "simkai.ttf", "STXINGKA.TTF"],
    "elegant": ["zaozigongfang-ya.ttf", "simsun.ttc", "STSONG.TTF", "msyh.ttc"]
}


# ========== 2. 百度实时热点采集 ==========
def fetch_materials_from_tier(tier_name):
    logging.info(f"\n[SCAN] 突破封锁，潜入全网实时热点榜单【{tier_name}】...")
    try:
        url = "https://top.baidu.com/board?tab=realtime"
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        resp = session.get(url, headers=headers, timeout=10)
        resp.encoding = 'utf-8'
        soup = BeautifulSoup(resp.text, 'html.parser')

        results = []
        for item in soup.select('.c-single-text-title'):
            title = item.get_text(strip=True)
            parent_a = item.find_parent('a')
            link = parent_a.get('href', '') if parent_a else url
            if title: results.append({"source": link, "text": title, "real_img": ""})

        if results:
            chosen = random.choice(results[:30])
            logging.info(f"🔗 [捕获真实热点链接]: {chosen['source']}")
            logging.info(f"📝 [捕获最新热点事件]: {chosen['text'][:40]}...")
            return chosen
    except Exception as e:
        logging.warning(f"⚠️ 榜单采集异常: {e}")

    return {"source": "https://top.baidu.com", "text": "2026全球前沿科技AI博览会", "real_img": ""}


# ========== 3. AI 商业量化重构引擎 ==========
ZHIPU_API_KEY = os.getenv("ZHIPU_API_KEY", "")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
MODEL_POOL = [
    {"name": "deepseek", "url": "https://api.deepseek.com/v1/chat/completions", "key": DEEPSEEK_API_KEY,
     "model": "deepseek-chat", "timeout": 30},
    {"name": "zhipu", "url": "https://open.bigmodel.cn/api/paas/v4/chat/completions", "key": ZHIPU_API_KEY,
     "model": "glm-4-flash", "timeout": 30}
]


def call_model_with_fallback(prompt):
    def try_model(info):
        if not info["key"]: return None
        headers = {"Authorization": f"Bearer {info['key']}", "Content-Type": "application/json"}
        payload = {"model": info["model"], "messages": [{"role": "user", "content": prompt}], "temperature": 0.8}
        try:
            resp = requests.post(info["url"], json=payload, headers=headers, timeout=info["timeout"],
                                 proxies={"http": None, "https": None})
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
        except Exception:
            return None

    with ThreadPoolExecutor(max_workers=len(MODEL_POOL)) as executor:
        futures = {executor.submit(try_model, info): info for info in MODEL_POOL}
        for future in as_completed(futures):
            res = future.result()
            if res is not None:
                for f in futures: f.cancel()
                return res
    raise RuntimeError("大模型全部罢工")


def ai_remix_engine(sample1, sample2):
    prompt = f"""
你是千图网视觉总监兼顶尖全案营销文案。请根据以下最新的【真实新闻热点】，【二次改编】为完整的商业H5海报。
【量化标准】：
1. 背景生图：要求高质感、电影级暗光，必须有具体的画面主体（如机器人/数字人/大楼等），且正中心必须留空 (negative space in center for typography)。
2. 必须根据主题从字体目录中选择一种风格。
3. 必须生成极具吸引力的全套营销文案（包括页头、公告、带详细描述的卖点、表单引导语），杜绝任何“默认占位符”感！

【字体风格目录】：
- "tech": 科技/现代/未来感
- "bold": 力量/大促/活泼
- "calligraphy": 国风/传统/大气
- "elegant": 优雅/美业/文艺

输出严格 JSON：
{{
  "design_score": (1-100分),
  "design_review": "商业改编思路及文案包装考量。",
  "cover_prompt_en": "纯英文画图提示词，必须写出具体物体，带有 negative space in center, NO text",
  "font_style": "必须填入 tech, bold, calligraphy 或 elegant 中的一个",
  "page_title": "极简页头名称(4-6字，如: 科技峰会/官方主页，将显示在顶部)",
  "english_title": "英文标题（全大写，如 FUTURE TECH SUMMIT）",
  "hero_title": "商业主标题（6-12字，要有冲击力）",
  "hero_subtitle": "海报副标题（活动卖点或说明）",
  "notice_text": "吸引人的滚动公告文案(如: 🔥热烈庆祝2026大会VIP门票已售罄，普通票余量告急！)",
  "form_title": "表单引导标题(如: 立即预约获取免费席位)",
  "modules": ["Notice", "List", "Form"], 
  "features": [
    {{"title":"核心卖点1标题","desc":"一段极具吸引力的详细优势描述文案，不少于15个字","icon_en":"gift"}},
    {{"title":"核心卖点2标题","desc":"一段极具吸引力的详细优势描述文案，不少于15个字","icon_en":"shield"}}
  ],
  "colors": {{"primary": "#e11d48","headerBg": "#ffffff","heroTitColor": "#FFFFFF"}}
}}
热点 1: {sample1['text']}
热点 2: {sample2['text']}
"""
    for review_loop in range(3):
        try:
            result = call_model_with_fallback(prompt)
            cleaned = result.replace("```json", "").replace("```", "").strip()
            plan = json.loads(cleaned)
            score = plan.get("design_score", 0)
            logging.info(f"🧠 [AI 审查 - 尝试 {review_loop+1}] 评分: {score}分 | 字体风格: {plan.get('font_style', 'tech')}")
            if score >= 90: return plan
        except Exception:
            time.sleep(1)

    return {
        "cover_prompt_en": "futuristic robot, cinematic dark lighting, negative space in center",
        "font_style": "tech",
        "page_title": "官方活动主页", "english_title": "GLOBAL AI SUMMIT",
        "hero_title": "全球AI前沿峰会", "hero_subtitle": "探索通用人工智能未来",
        "notice_text": "🔥 2026全球前沿科技博览会门票火热抢购中，名额有限！",
        "form_title": "立即预约尊享VIP席位",
        "modules": ["List", "Form"],
        "features": [
            {"title": "全明星大咖阵容", "desc": "汇聚全球顶尖科技巨头与行业领袖，深度剖析行业趋势", "icon_en": "diamond"},
            {"title": "沉浸式前沿体验", "desc": "10+国家展团联袂呈现，带你零距离接触未来黑科技", "icon_en": "rocket"}
        ],
        "colors": {"primary": "#D97706", "headerBg": "#ffffff", "heroTitColor": "#FFFFFF"}
    }


# ========== 4. 视觉中台 (FLUX 具象生图 + 绝对隔离排版) ==========
def generate_ai_image_base64(prompt_en, is_icon=False):
    width, height = (120, 120) if is_icon else (400, 600)
    seed = random.randint(1, 9999999)

    if is_icon:
        premium_prompt = f"{prompt_en}, 3D icon, clean white background"
    else:
        premium_prompt = f"{prompt_en}, masterpiece, highly detailed, cinematic lighting, key visual concept art, NO text, NO watermarks"

    safe_prompt = premium_prompt.strip().replace(' ', '%20')
    url = f"https://image.pollinations.ai/prompt/{safe_prompt}?width={width}&height={height}&nologo=true&seed={seed}&model=flux"

    for attempt in range(3):
        try:
            logging.info(f"🎨 [FLUX 作图中 - 尝试 {attempt + 1}/3]...")
            resp = session.get(url, timeout=60)
            if resp.status_code == 429:
                time.sleep((attempt + 1) * 5)
                continue
            resp.raise_for_status()

            img = Image.open(BytesIO(resp.content))
            if is_icon: img = img.resize((120, 120), getattr(Image, 'Resampling', Image).LANCZOS if hasattr(Image,
                                                                                                            'Resampling') else Image.ANTIALIAS)

            buffered = BytesIO()
            img.save(buffered, format="JPEG", quality=88)
            logging.info(f"✅ [FLUX 出图成功] 商业级素材完成！")
            return f"data:image/jpeg;base64,{base64.b64encode(buffered.getvalue()).decode('utf-8')}"
        except Exception:
            time.sleep(3)

    r, g, b = random.randint(20, 40), random.randint(20, 40), random.randint(40, 70)
    img = Image.new('RGB', (width, height), color=(r, g, b))
    buffered = BytesIO()
    img.save(buffered, format="JPEG", quality=85)
    return f"data:image/jpeg;base64,{base64.b64encode(buffered.getvalue()).decode('utf-8')}"


def get_text_size(draw_obj, text, font):
    if hasattr(draw_obj, 'textbbox'):
        bbox = draw_obj.textbbox((0, 0), text, font=font)
        return bbox[2] - bbox[0], bbox[3] - bbox[1]
    return draw_obj.textsize(text, font=font)


def composite_poster_cover(img_base64_or_path, hero_title, sub_title="", english_title="", colors_dict=None,
                           font_style="tech"):
    try:
        if img_base64_or_path.startswith("data:image"):
            header, encoded = img_base64_or_path.split(",", 1)
            img = Image.open(BytesIO(base64.b64decode(encoded))).convert("RGBA")
        else:
            img = Image.open(img_base64_or_path).convert("RGBA")

        width, height = img.size
        draw_temp = ImageDraw.Draw(img)

        font_candidates = FONT_CATALOG.get(font_style, FONT_CATALOG["tech"])
        sys_font = None
        ubuntu_font = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"

        for font_name in font_candidates:
            path = os.path.join("C:/Windows/Fonts", font_name)
            if os.path.exists(path):
                sys_font = path
                break

        if not sys_font:
            sys_font = next(
                (f for f in ["C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/simhei.ttf", ubuntu_font] if
                 os.path.exists(f)), None)

        logging.info(f"🖋️ [字体引擎] 采用风格: {font_style} | 选用字体文件: {sys_font or '默认无中文'}")

        title_size = int(width * 0.13)
        sub_size = int(width * 0.045)
        en_size = int(width * 0.038)

        title_font = ImageFont.truetype(sys_font, title_size) if sys_font else ImageFont.load_default()
        sub_font = ImageFont.truetype(sys_font, sub_size) if sys_font else ImageFont.load_default()
        en_font = ImageFont.truetype(sys_font, en_size) if sys_font else ImageFont.load_default()

        max_width = width * 0.8

        def wrap_text(text, font):
            for d in ['，', ',', ' ', '、', '·', '|', '：', ':']:
                text = text.replace(d, '\n')
            final_lines = []
            for semantic_line in text.split('\n'):
                semantic_line = semantic_line.strip()
                if not semantic_line: continue
                curr = ""
                for char in semantic_line:
                    w, _ = get_text_size(draw_temp, curr + char, font)
                    if w <= max_width:
                        curr += char
                    else:
                        if curr: final_lines.append(curr)
                        curr = char
                if curr: final_lines.append(curr)
            return final_lines

        title_lines = wrap_text(hero_title, title_font)
        sub_lines = wrap_text(sub_title, sub_font) if sub_title else []
        en_text = english_title if english_title else "EXCLUSIVE DESIGN"

        en_w, en_h = get_text_size(draw_temp, en_text, en_font)
        spacing_en_to_title = 15
        spacing_title_line = 10
        spacing_title_to_divider = 20
        spacing_divider_to_sub = 20
        spacing_sub_line = 10

        total_h = en_h + spacing_en_to_title
        title_heights = [get_text_size(draw_temp, l, title_font)[1] for l in title_lines]
        total_h += sum(title_heights) + (len(title_lines) - 1) * spacing_title_line

        if sub_lines:
            total_h += spacing_title_to_divider + 4 + spacing_divider_to_sub
            sub_heights = [get_text_size(draw_temp, l, sub_font)[1] for l in sub_lines]
            total_h += sum(sub_heights) + (len(sub_lines) - 1) * spacing_sub_line

        start_y = (height - total_h) / 2

        shadow_layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
        shadow_draw = ImageDraw.Draw(shadow_layer)
        soft_shadow = (0, 0, 0, 160)

        draw_queue = []
        title_positions = []
        current_y = start_y

        draw_queue.append(((width - en_w) / 2, current_y, en_text, en_font, "#E5E7EB", False))
        current_y += en_h + spacing_en_to_title

        for i, line in enumerate(title_lines):
            lw, lh = get_text_size(draw_temp, line, title_font)
            pos_x = (width - lw) / 2
            draw_queue.append((pos_x, current_y, line, title_font, None, True))
            title_positions.append((pos_x, current_y, line))
            current_y += lh + spacing_title_line

        line_y = current_y + spacing_title_to_divider - 10
        current_y += spacing_title_to_divider + 4 + spacing_divider_to_sub

        for i, line in enumerate(sub_lines):
            lw, lh = get_text_size(draw_temp, line, sub_font)
            draw_queue.append(((width - lw) / 2, current_y, line, sub_font, "#FFFFFF", False))
            current_y += lh + spacing_sub_line

        for x, y, text, font, color, is_title in draw_queue:
            if hasattr(shadow_draw, 'text'):
                try:
                    shadow_draw.text((x, y), text, font=font, fill=soft_shadow, stroke_width=4, stroke_fill=soft_shadow)
                except TypeError:
                    shadow_draw.text((x, y), text, font=font, fill=soft_shadow)

        shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=10))
        img = Image.alpha_composite(img, shadow_layer)

        for x, y, text in title_positions:
            tw, th = get_text_size(draw_temp, text, title_font)
            mask = Image.new('L', img.size, 0)
            mask_draw = ImageDraw.Draw(mask)
            mask_draw.text((x, y), text, font=title_font, fill=255)

            gradient = Image.new('RGBA', img.size, (0, 0, 0, 0))
            grad_draw = ImageDraw.Draw(gradient)
            for gy in range(int(y), int(y + th + 10)):
                ratio = (gy - y) / (th + 10) if th > 0 else 0
                ratio = max(0, min(1, ratio))
                r = int(255 - (255 - 212) * ratio)
                g = int(249 - (249 - 175) * ratio)
                b = int(230 - (230 - 55) * ratio)
                grad_draw.line([(x, gy), (x + tw, gy)], fill=(r, g, b, 255))

            img = Image.composite(gradient, img, mask)

        final_draw = ImageDraw.Draw(img)

        for x, y, text, font, color, is_title in draw_queue:
            if not is_title:
                final_draw.text((x, y), text, fill=color, font=font)

        line_w = int(width * 0.15)
        final_draw.line([(width / 2 - line_w / 2, line_y), (width / 2 + line_w / 2, line_y)], fill="#D4AF37", width=3)

        border_margin = int(width * 0.04)
        final_draw.rectangle(
            [border_margin, border_margin, width - border_margin, height - border_margin],
            outline=(255, 255, 255, 70), width=1
        )

        buffered = BytesIO()
        img.convert("RGB").save(buffered, format="JPEG", quality=95)
        return f"data:image/jpeg;base64,{base64.b64encode(buffered.getvalue()).decode('utf-8')}"

    except Exception as e:
        logging.warning(f"⚠️ 高级排版渲染失败: {e}")
        return img_base64_or_path


def parse_color_to_strict_rgba(c):
    if isinstance(c, dict) and 'r' in c:
        return f"rgba({c['r']},{c['g']},{c['b']},{int(c.get('a', 1))})"
    c = str(c).strip().lower()
    if c.startswith('#'):
        c = c.lstrip('#')
        if len(c) == 3: c = ''.join([x * 2 for x in c])
        if len(c) == 6:
            return f"rgba({int(c[0:2], 16)},{int(c[2:4], 16)},{int(c[4:6], 16)},1)"
        elif len(c) == 8:
            return f"rgba({int(c[0:2], 16)},{int(c[2:4], 16)},{int(c[4:6], 16)},1)"
    elif c.startswith('rgba'):
        try:
            parts = c.replace('rgba(', '').replace(')', '').split(',')
            return f"rgba({int(parts[0].strip())},{int(parts[1].strip())},{int(parts[2].strip())},1)"
        except:
            pass
    elif c.startswith('rgb'):
        try:
            parts = c.replace('rgb(', '').replace(')', '').split(',')
            return f"rgba({int(parts[0].strip())},{int(parts[1].strip())},{int(parts[2].strip())},1)"
        except:
            pass
    return "rgba(255,255,255,1)"


COLOR_KEYS = ["bgColor", "color", "titColor", "subTitColor", "btnColor", "btnTextColor"]


def merge_config(default_config, override_config):
    for k, v in (override_config or {}).items():
        if k in COLOR_KEYS:
            default_config[k] = parse_color_to_strict_rgba(v)
        else:
            default_config[k] = v
    return default_config


# ========== 5. 基础组件与模板装配 ==========
def make_header(conf_override=None, point_override=None, index=0):
    base_layout = {"baseTop": 0, "baseLeft": 0, "baseRadius": 0, "baseRotate": 0, "baseScale": 100, "baseHeight": 100,
                   "baseWidth": 100}
    default_config = {**base_layout, "bgColor": parse_color_to_strict_rgba("#ffffff"),
                      "color": parse_color_to_strict_rgba("#333333"), "logoText": "未命名", "fontSize": 18, "height": 50,
                      "logo": [], "logoUrl": "", "textAlign": "center", "fontWeight": "normal", "fontStyle": "normal",
                      "bgUrl": []}
    return {"id": f"header_{uuid_hex()}",
            "item": {"type": "Header", "config": merge_config(default_config, conf_override), "category": "base",
                     "editableEl": [{"key": "logoText", "name": "标题文字", "type": "Text"},
                                    {"key": "fontSize", "name": "字号", "type": "Number"},
                                    {"key": "color", "name": "文字颜色", "type": "Color"},
                                    {"key": "bgColor", "name": "背景颜色", "type": "Color"},
                                    {"key": "textAlign", "name": "对齐方式", "type": "Radio",
                                     "range": [{"key": "left", "text": "左"}, {"key": "center", "text": "中"},
                                               {"key": "right", "text": "右"}]},
                                    {"key": "fontWeight", "name": "文字粗细", "type": "Radio",
                                     "range": [{"key": "normal", "text": "常规"}, {"key": "bold", "text": "加粗"}]},
                                    {"key": "fontStyle", "name": "文字斜体", "type": "Radio",
                                     "range": [{"key": "normal", "text": "常规"}, {"key": "italic", "text": "斜体"}]},
                                    {"key": "bgUrl", "name": "背景图片", "type": "Upload", "isCrop": False}]},
            "point": point_override or {"i": f"x-{index}", "x": 0, "y": 0, "w": 24, "h": 25, "isBounded": True},
            "status": "inToCanvas"}


def make_image(conf_override=None, point_override=None, index=0):
    base_layout = {"baseTop": 0, "baseLeft": 0, "baseRadius": 0, "baseRotate": 0, "baseScale": 100, "baseHeight": 100,
                   "baseWidth": 100}
    default_config = {**base_layout, "translate": [0, 0], "align": "center", "round": 0, "titText": "",
                      "titFontSize": 42, "titColor": parse_color_to_strict_rgba("rgba(255,255,255,1)"),
                      "titFontWeight": "900", "subTitText": "", "subTitFontSize": 18,
                      "subTitColor": parse_color_to_strict_rgba("rgba(255,255,255,0.9)"),
                      "imgUrl": [{"uid": "001", "name": "cover.png", "status": "done", "url": ""}]}
    return {"id": f"image_{uuid_hex()}",
            "item": {"type": "Image", "config": merge_config(default_config, conf_override), "category": "base",
                     "editableEl": [{"key": "titText", "name": "主标题", "type": "Text"},
                                    {"key": "subTitText", "name": "副标题", "type": "Text"},
                                    {"key": "imgUrl", "name": "背景图", "type": "Upload", "isCrop": False}]},
            "point": point_override or {"i": f"x-{index}", "x": 0, "y": 0, "w": 24, "h": 281, "isBounded": True},
            "status": "inToCanvas"}


def make_notice(conf_override=None, point_override=None, index=0):
    base_layout = {"baseTop": 0, "baseLeft": 0, "baseRadius": 0, "baseRotate": 0, "baseScale": 100, "baseHeight": 100,
                   "baseWidth": 100}
    default_config = {**base_layout, "text": "公告内容", "bgColor": parse_color_to_strict_rgba("#FEF3C7"),
                      "color": parse_color_to_strict_rgba("#D97706")}
    return {"id": f"notice_{uuid_hex()}",
            "item": {"type": "Notice", "config": merge_config(default_config, conf_override), "category": "base",
                     "editableEl": [{"key": "text", "name": "公告内容", "type": "Text"},
                                    {"key": "bgColor", "name": "背景色", "type": "Color"},
                                    {"key": "color", "name": "文字颜色", "type": "Color"}]},
            "point": point_override or {"i": f"x-{index}", "x": 0, "y": 0, "w": 24, "h": 20, "isBounded": True},
            "status": "inToCanvas"}


def make_list(conf_override=None, point_override=None, index=0):
    base_layout = {"baseTop": 0, "baseLeft": 0, "baseRadius": 0, "baseRotate": 0, "baseScale": 100, "baseHeight": 100,
                   "baseWidth": 100}
    default_config = {**base_layout, "sourceData": [], "isSearch": False, "padding": 16, "round": 8, "imgSize": "60",
                      "fontSize": 16, "color": parse_color_to_strict_rgba("rgba(60,60,60,1)")}
    return {"id": f"list_{uuid_hex()}",
            "item": {"type": "List", "config": merge_config(default_config, conf_override), "category": "base",
                     "editableEl": [{"key": "sourceData", "name": "数据源", "type": "DataList", "cropRate": 1},
                                    {"key": "imgSize", "name": "图片大小", "type": "Select",
                                     "range": [{"key": "60", "text": "60x60"}, {"key": "80", "text": "80x80"},
                                               {"key": "100", "text": "100x100"}]},
                                    {"key": "fontSize", "name": "文字大小", "type": "Number"},
                                    {"key": "color", "name": "文字颜色", "type": "Color"}]},
            "point": point_override or {"i": f"x-{index}", "x": 0, "y": 0, "w": 24, "h": 130, "isBounded": True},
            "status": "inToCanvas"}


def make_form(conf_override=None, point_override=None, index=0):
    base_layout = {"baseTop": 0, "baseLeft": 0, "baseRadius": 0, "baseRotate": 0, "baseScale": 100, "baseHeight": 100,
                   "baseWidth": 100}
    default_config = {**base_layout, "title": "抢占名额", "fontSize": 20,
                      "titColor": parse_color_to_strict_rgba("rgba(60,60,60,1)"),
                      "bgColor": parse_color_to_strict_rgba("rgba(255,255,255,1)"),
                      "btnColor": parse_color_to_strict_rgba("rgba(225,29,72,1)"),
                      "btnTextColor": parse_color_to_strict_rgba("rgba(255,255,255,1)"),
                      "formControls": [{"id": "1", "type": "Text", "label": "姓名", "placeholder": "请输入姓名"},
                                       {"id": "2", "type": "Number", "label": "电话", "placeholder": "请输入手机号"}]}
    return {"id": f"form_{uuid_hex()}",
            "item": {"type": "Form", "config": merge_config(default_config, conf_override), "category": "base",
                     "editableEl": [{"key": "title", "name": "标题", "type": "Text"},
                                    {"key": "formControls", "name": "表单控件", "type": "FormItems"},
                                    {"key": "btnColor", "name": "按钮颜色", "type": "Color"}]},
            "point": point_override or {"i": f"x-{index}", "x": 0, "y": 0, "w": 24, "h": 140, "isBounded": True},
            "status": "inToCanvas"}


def build_native_schema(blueprint):
    logging.info("[ASSEMBLE] 执行组件严丝合缝式装配...")
    colors = blueprint.get("colors", {})
    modules = blueprint.get("modules", ["Notice", "List", "Form"])

    schema_list = []
    current_y = 0

    schema_list.append(
        make_header({"bgColor": colors.get("headerBg", "#ffffff"), "logoText": blueprint.get("page_title", "活动主页")},
                    {"i": "x-0", "x": 0, "y": current_y, "w": 24, "h": 25, "isBounded": True}, 0))
    current_y += 25

    cover_base64 = generate_ai_image_base64(blueprint.get("cover_prompt_en", "minimalist background"))
    cover_base64 = composite_poster_cover(cover_base64, blueprint.get('hero_title', ''),
                                          blueprint.get('hero_subtitle', ''), blueprint.get('english_title', ''),
                                          colors, blueprint.get('font_style', 'tech'))
    cover_h = 281
    schema_list.append(make_image({"imgUrl": [{"uid": "1", "name": "c.png", "status": "done", "url": cover_base64}]},
                                  {"i": "x-1", "x": 0, "y": current_y, "w": 24, "h": cover_h, "isBounded": True}, 1))
    current_y += cover_h

    index = 2
    for mod in modules:
        if mod == "Notice":
            notice_txt = blueprint.get("notice_text", f"🔥 最新动态：{blueprint.get('hero_subtitle')}")
            schema_list.append(make_notice({"text": notice_txt, "bgColor": "#FEF3C7", "color": "#D97706"},
                                           {"i": f"x-{index}", "x": 0, "y": current_y, "w": 24, "h": 20,
                                            "isBounded": True}, index))
            current_y += 20
        elif mod == "List":
            features = blueprint.get("features", [])
            source = []
            for i, f in enumerate(features[:2]):
                title = f.get("title", f.get("text", "亮点特色"))
                desc = f.get("desc", "点击了解更多专属特权和详细服务内容")
                try:
                    icon_url = generate_ai_image_base64(f.get("icon_en", "icon"), True)
                except Exception:
                    icon_url = ""
                source.append({"id": str(i), "title": title, "desc": desc, "price": "HOT",
                               "imgUrl": [{"uid": "1", "name": "i", "status": "done", "url": icon_url}]})
                time.sleep(1)
            list_h = 40 + len(source) * 45
            schema_list.append(make_list({"sourceData": source},
                                         {"i": f"x-{index}", "x": 0, "y": current_y, "w": 24, "h": list_h,
                                          "isBounded": True}, index))
            current_y += list_h
        elif mod == "Form":
            form_title = blueprint.get("form_title", "立即预约获取名额")
            schema_list.append(make_form({"title": form_title, "btnColor": colors.get("primary", "#e11d48")},
                                         {"i": f"x-{index}", "x": 0, "y": current_y, "w": 24, "h": 140,
                                          "isBounded": True}, index))
            current_y += 140
        index += 1

    return schema_list, cover_base64


def push_to_mall(page_title, schema_json, cover_url):
    TURSO_DB_URL = os.environ.get("TURSO_DB_URL")
    TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

    if not TURSO_DB_URL:
        logging.error("❌ 无法连接数据库，请检查 GitHub Secrets 中的 TURSO_DB_URL 配置")
        return

    try:
        conn = libsql.connect(database=TURSO_DB_URL, auth_token=TURSO_AUTH_TOKEN)
        cursor = conn.cursor()

        # 1. 基础建表逻辑
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS h5_works (
                id TEXT PRIMARY KEY,
                user_id INTEGER DEFAULT 1,
                title TEXT,
                subTitle TEXT,
                schema_json TEXT,
                cover_url TEXT,
                category TEXT DEFAULT 'h5',
                is_published INTEGER DEFAULT 1,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # 🌟 2. 加上这 3 行核心自愈 SQL！
        # 哪怕远端是一张没有这些字段的老表，也能自动静默增齐字段，绝不会再抛 SQLITE_UNKNOWN！
        for alter_sql in [
            "ALTER TABLE h5_works ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP",
            "ALTER TABLE h5_works ADD COLUMN user_id INTEGER DEFAULT 1",
            "ALTER TABLE h5_works ADD COLUMN subTitle TEXT DEFAULT ''"
        ]:
            try:
                cursor.execute(alter_sql)
            except Exception:
                pass  # 如果表里已经有这个字段了，静默跳过即可

        # 3. 稳妥写入最新AI生成的商业落地页
        work_id = f"H5_{int(time.time())}"
        cursor.execute("""
            INSERT INTO h5_works (id, user_id, title, subTitle, schema_json, cover_url, category, is_published, updated_at)
            VALUES (?, 1, ?, ?, ?, ?, 'h5', 1, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET 
                title = excluded.title, 
                schema_json = excluded.schema_json, 
                cover_url = excluded.cover_url,
                updated_at = CURRENT_TIMESTAMP
        """, (work_id, page_title, "全自动营销海报", json.dumps(schema_json, ensure_ascii=False), cover_url))

        conn.commit()
        logging.info(f"✅ 【{page_title}】 已成功直连写入 Turso 云端数据库，大盘已同步！")
    except Exception as e:
        logging.error(f"❌ 入库失败：{e}")


# ========== 7. 启动流水线 ==========
if __name__ == "__main__":
    print("🚀 酷猫爆款印钞机 (全云端自动化极客版)")
    for tier in ["Tier_1_Top10", "Tier_2_Top100"]:
        try:
            s1 = fetch_materials_from_tier(tier)
            s2 = fetch_materials_from_tier(tier)

            print(f"\n💡 本次融合基底素材：")
            print(f"   [素材A] {s1['text'][:30]}... (来源: {s1['source']})")
            print(f"   [素材B] {s2['text'][:30]}... (来源: {s2['source']})\n")

            blueprint = ai_remix_engine(s1, s2)
            schema, cover = build_native_schema(blueprint)
            push_to_mall(blueprint['page_title'], schema, cover)
        except Exception as e:
            logging.exception(f"流水线异常：{e}")
        time.sleep(1)
        print("-" * 60)
    print("🎉 任务完成！这波生成的模板已经稳稳躺在你的云端大盘里了！")

    # 🌟 核心修改：在主干脚本干完活后，自动顺手唤醒 AI CEO 一起思考并退出！
    print("\n🧠 [2/2] 正在唤醒 AI CEO 进行夜间复盘与思考...")
    try:
        from ai_ceo_core import AICEOSystem
        ceo = AICEOSystem()
        ceo.run_once()
    except Exception as e:
        logging.error(f"❌ AI CEO 思考失败: {e}")
    print("🎉 全部云端任务完美竣工！")