"""
BossSay PDF 简历解析服务
启动方式: python app.py
"""

import io
import json
import os
import re
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

try:
    import pdfplumber
except ImportError:
    print("正在安装 pdfplumber...")
    os.system(f"{sys.executable} -m pip install pdfplumber -q")
    import pdfplumber


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """从 PDF 字节流中提取文本"""
    text_parts = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
    return "\n".join(text_parts)


def parse_resume(text: str) -> dict:
    """
    智能解析简历文本，拆分为：简历摘要、工作经历、技能标签
    """
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    full_text = "\n".join(lines)

    # ---- 技能关键词提取 ----
    skill_patterns = [
        # 编程语言
        r'\b(Java|Python|JavaScript|TypeScript|Go|Golang|Rust|C\+\+|C#|Ruby|PHP|Swift|Kotlin|R|Scala|Lua|Dart)\b',
        # 前端
        r'\b(React|Vue|Vue\.js|Angular|Next\.js|Nuxt|Svelte|jQuery|Bootstrap|Tailwind|Webpack|Vite)\b',
        # 后端 / 框架
        r'\b(Spring|SpringBoot|Django|Flask|FastAPI|Express|NestJS|Laravel|Rails|Gin)\b',
        # 数据库
        r'\b(MySQL|PostgreSQL|MongoDB|Redis|Elasticsearch|SQLite|Oracle|SQL Server|ClickHouse|HBase)\b',
        # 云 / DevOps
        r'\b(Docker|Kubernetes|K8s|AWS|Azure|GCP|阿里云|腾讯云|Jenkins|CI/CD|Nginx|Linux|Git)\b',
        # AI / 数据
        r'\b(TensorFlow|PyTorch|Keras|Pandas|NumPy|Scikit-learn|Spark|Hadoop|Flink|Kafka|RabbitMQ)\b',
        # 其他常见技能
        r'\b(RESTful|GraphQL|gRPC|WebSocket|微服务|分布式|高并发|性能优化|数据结构|算法)\b',
    ]

    found_skills = set()
    for pattern in skill_patterns:
        matches = re.findall(pattern, full_text, re.IGNORECASE)
        for m in matches:
            found_skills.add(m)

    # ---- 工作经历识别 ----
    experience_keywords = [
        '工作经历', '工作经验', '项目经历', '项目经验', '实习经历',
        '工作时间', '任职', '负责', '参与', '担任', '开发', '设计',
    ]

    experience_lines = []
    in_experience = False
    for line in lines:
        # 检测经历板块标题
        if any(kw in line for kw in ['工作经历', '工作经验', '项目经历', '项目经验', '实习经历', '教育经历']):
            in_experience = True
            experience_lines.append(line)
            continue
        # 检测到下一个板块标题时停止
        if in_experience and re.match(r'^[一二三四五六七八九十]+[、.．]|^[（(]\s*[一二三四五六七八九十]+\s*[）)]|^\d+[、.．]', line):
            # 如果是新的编号板块，可能是经历的一部分，继续
            pass
        if in_experience:
            # 遇到明确的新板块标题则停止
            stop_keywords = ['个人信息', '基本信息', '自我评价', '求职意向', '教育背景', '证书荣誉', '获奖情况']
            if any(kw in line for kw in stop_keywords):
                in_experience = False
                continue
            experience_lines.append(line)

    # 如果没找到明确的经历板块，尝试提取包含关键词的段落
    if not experience_lines:
        for i, line in enumerate(lines):
            if any(kw in line for kw in ['负责', '参与', '开发', '设计', '实现', '搭建', '优化']):
                start = max(0, i - 1)
                end = min(len(lines), i + 3)
                experience_lines.extend(lines[start:end])

    experience_text = "\n".join(experience_lines[:30])  # 限制长度

    # ---- 简历摘要 ----
    # 取前几行作为摘要（通常是姓名、学校、总结性描述）
    summary_lines = lines[:min(15, len(lines))]
    summary_text = "\n".join(summary_lines)

    return {
        "summary": summary_text,
        "experience": experience_text,
        "skills": ", ".join(sorted(found_skills)) if found_skills else "",
        "fullText": full_text[:5000],  # 限制最大长度
    }


class RequestHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        """处理 CORS 预检请求"""
        self.send_response(200)
        self._set_cors_headers()
        self.end_headers()

    def do_POST(self):
        """处理 PDF 上传"""
        parsed = urlparse(self.path)

        if parsed.path == "/api/parse-pdf":
            self._handle_parse_pdf()
        else:
            self._send_json(404, {"error": "Not found"})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self._send_json(200, {"status": "ok"})
        else:
            self._send_json(404, {"error": "Not found"})

    def _handle_parse_pdf(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length > 10 * 1024 * 1024:  # 10MB 限制
                self._send_json(400, {"error": "文件大小不能超过 10MB"})
                return

            body = self.rfile.read(content_length)
            content_type = self.headers.get("Content-Type", "")

            if "multipart/form-data" in content_type:
                # 从 multipart 中提取文件
                boundary = content_type.split("boundary=")[1].encode()
                pdf_bytes = self._extract_file_from_multipart(body, boundary)
            else:
                pdf_bytes = body

            if not pdf_bytes:
                self._send_json(400, {"error": "未收到 PDF 文件"})
                return

            # 提取文本
            raw_text = extract_text_from_pdf(pdf_bytes)
            if not raw_text.strip():
                self._send_json(400, {"error": "PDF 中未提取到文本内容，可能是扫描件（图片 PDF）"})
                return

            # 智能解析
            parsed = parse_resume(raw_text)

            self._send_json(200, {
                "success": True,
                **parsed,
            })

        except Exception as e:
            print(f"[ERROR] {e}")
            self._send_json(500, {"error": "解析失败: " + str(e)})

    def _extract_file_from_multipart(self, body: bytes, boundary: bytes) -> bytes:
        """从 multipart/form-data 中提取 PDF 文件内容"""
        parts = body.split(b"--" + boundary)
        for part in parts:
            if b"filename=" in part and b".pdf" in part.lower():
                # 找到文件内容（跳过头部）
                header_end = part.find(b"\r\n\r\n")
                if header_end == -1:
                    header_end = part.find(b"\n\n")
                if header_end != -1:
                    file_data = part[header_end + 4:]
                    # 去掉尾部的 \r\n
                    if file_data.endswith(b"\r\n"):
                        file_data = file_data[:-2]
                    return file_data
        return b""

    def _send_json(self, status: int, data: dict):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._set_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def _set_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format % args}")


def main():
    port = 18752
    server = HTTPServer(("127.0.0.1", port), RequestHandler)
    print(f"")
    print(f"  🎯 BossSay PDF 解析服务已启动")
    print(f"  📡 地址: http://127.0.0.1:{port}")
    print(f"  📄 上传: POST http://127.0.0.1:{port}/api/parse-pdf")
    print(f"")
    print(f"  保持此窗口运行，然后在插件中上传简历 PDF")
    print(f"  按 Ctrl+C 停止服务")
    print(f"")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止")
        server.server_close()


if __name__ == "__main__":
    main()
