from pathlib import Path
import re
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Preformatted, Table, TableStyle
from reportlab.graphics.shapes import Drawing, Rect, String, Line

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "Lucky-Relay-Controller-v1.0-Installation-and-Testing-Guide.pdf"
FILES = [
    "BEGINNER-GUIDE.md", "BUILD-GUIDE.md", "FLASH-GUIDE.md", "HARDWARE-TEST.md",
    "SAFE-BOOT-TEST.md", "POWER-LOSS-TEST.md", "TROUBLESHOOTING.md",
]

font = Path(r"C:\Windows\Fonts\tahoma.ttf")
bold = Path(r"C:\Windows\Fonts\tahomabd.ttf")
pdfmetrics.registerFont(TTFont("Thai", str(font)))
pdfmetrics.registerFont(TTFont("ThaiBold", str(bold if bold.exists() else font)))

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="ThaiTitle", parent=styles["Title"], fontName="ThaiBold", fontSize=22, leading=30, alignment=TA_CENTER, textColor=colors.HexColor("#12355B"), spaceAfter=16))
styles.add(ParagraphStyle(name="ThaiH1", parent=styles["Heading1"], fontName="ThaiBold", fontSize=16, leading=22, textColor=colors.HexColor("#12355B"), spaceBefore=12, spaceAfter=8))
styles.add(ParagraphStyle(name="ThaiH2", parent=styles["Heading2"], fontName="ThaiBold", fontSize=12, leading=18, textColor=colors.HexColor("#1B6CA8"), spaceBefore=10, spaceAfter=5))
styles.add(ParagraphStyle(name="ThaiBody", parent=styles["BodyText"], fontName="Thai", fontSize=10, leading=16, spaceAfter=5))
styles.add(ParagraphStyle(name="ThaiSmall", parent=styles["BodyText"], fontName="Thai", fontSize=8.5, leading=12, textColor=colors.HexColor("#555555")))
styles.add(ParagraphStyle(name="ThaiCode", fontName="Courier", fontSize=7.5, leading=10, backColor=colors.HexColor("#F1F5F9"), borderPadding=6, spaceBefore=4, spaceAfter=7))

def footer(canvas, doc):
    canvas.saveState(); canvas.setFont("Thai", 8); canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawString(18 * mm, 12 * mm, "Lucky Relay Controller v1.0 - คู่มือติดตั้งและทดสอบ")
    canvas.drawRightString(192 * mm, 12 * mm, f"หน้า {doc.page}")
    canvas.restoreState()

def diagram(title, labels):
    width, height = 174 * mm, 52 * mm
    drawing = Drawing(width, height)
    drawing.add(String(0, height - 10, title, fontName="ThaiBold", fontSize=12, fillColor=colors.HexColor("#12355B")))
    count = len(labels); box_w = 34 * mm; gap = (width - count * box_w) / max(1, count - 1); y = 16 * mm
    for i, label in enumerate(labels):
        x = i * (box_w + gap)
        drawing.add(Rect(x, y, box_w, 17 * mm, rx=3, ry=3, fillColor=colors.HexColor("#E8F2FB"), strokeColor=colors.HexColor("#1B6CA8")))
        drawing.add(String(x + box_w / 2, y + 8.5 * mm, label, textAnchor="middle", fontName="ThaiBold", fontSize=9, fillColor=colors.HexColor("#12355B")))
        if i < count - 1:
            drawing.add(Line(x + box_w, y + 8.5 * mm, x + box_w + gap - 3 * mm, y + 8.5 * mm, strokeColor=colors.HexColor("#1B6CA8"), strokeWidth=1.2))
            drawing.add(String(x + box_w + gap - 2 * mm, y + 7 * mm, ">", fontName="Helvetica-Bold", fontSize=10, fillColor=colors.HexColor("#1B6CA8")))
    return drawing

def p(text, style="ThaiBody"):
    text = escape(text)
    text = re.sub(r"`([^`]+)`", r"<font name='Courier'>\1</font>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    return Paragraph(text, styles[style])

def parse_markdown(path):
    story=[]; lines=path.read_text(encoding="utf-8").splitlines(); i=0; code=[]; table=[]
    def flush_code():
        nonlocal code
        if code: story.append(Preformatted("\n".join(code), styles["ThaiCode"])); code=[]
    def flush_table():
        nonlocal table
        if len(table) > 1:
            data=[]
            for row in table:
                cells=[c.strip() for c in row.strip().strip("|").split("|")]
                if all(re.fullmatch(r"[:-]+", c.replace(" ", "")) for c in cells): continue
                data.append([Paragraph(escape(c), styles["ThaiSmall"]) for c in cells])
            if data:
                t=Table(data, repeatRows=1, hAlign="LEFT")
                t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor("#DCEAF7")),("GRID",(0,0),(-1,-1),0.25,colors.HexColor("#94A3B8")),("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4)]))
                story.extend([t, Spacer(1,6)])
        table=[]
    while i < len(lines):
        line=lines[i]; stripped=line.strip()
        if stripped.startswith("```"):
            if code: flush_code()
            else:
                i+=1
                while i<len(lines) and not lines[i].strip().startswith("```"):
                    code.append(lines[i]); i+=1
                flush_code()
        elif stripped.startswith("|"):
            table.append(line)
        else:
            flush_table()
            if not stripped: story.append(Spacer(1,4))
            elif stripped.startswith("# "): story.append(Paragraph(escape(stripped[2:]), styles["ThaiTitle"]))
            elif stripped.startswith("## "): story.append(Paragraph(escape(stripped[3:]), styles["ThaiH1"]))
            elif stripped.startswith("### "): story.append(Paragraph(escape(stripped[4:]), styles["ThaiH2"]))
            elif stripped.startswith("[Screenshot:"):
                story.append(Table([[Paragraph(escape(stripped), styles["ThaiSmall"])]], colWidths=[170*mm], style=[("BACKGROUND",(0,0),(-1,-1),colors.HexColor("#FFF7D6")),("BOX",(0,0),(-1,-1),0.6,colors.HexColor("#D6A200")),("TOPPADDING",(0,0),(-1,-1),10),("BOTTOMPADDING",(0,0),(-1,-1),10)])); story.append(Spacer(1,6))
            elif stripped.startswith("-") or re.match(r"^\d+\.\s", stripped): story.append(p("• " + re.sub(r"^[-*]\s*|^\d+\.\s*", "", stripped)))
            elif stripped.startswith("> "): story.append(p(stripped[2:], "ThaiSmall"))
            else: story.append(p(stripped))
        i+=1
    flush_code(); flush_table(); return story

OUT.parent.mkdir(parents=True, exist_ok=True)
doc=SimpleDocTemplate(str(OUT), pagesize=A4, rightMargin=18*mm, leftMargin=18*mm, topMargin=18*mm, bottomMargin=20*mm)
story=[]
story += [
    Paragraph("ภาพรวมการทำงาน", styles["ThaiTitle"]),
    diagram("การต่อและการสั่งงานผ่าน USB", ["Windows", "USB", "ESP32", "Relay", "ไฟโต๊ะ"]), Spacer(1, 8),
    diagram("การสั่งงานผ่านเครือข่าย", ["Windows", "HTTP", "Wi‑Fi", "ESP32", "Relay"]), Spacer(1, 8),
    diagram("ลำดับการเริ่มใช้งาน", ["Build", "Upload", "Serial", "API", "Relay Test"]),
    PageBreak(),
]
for index, name in enumerate(FILES):
    if index: story.append(PageBreak())
    story.extend(parse_markdown(ROOT / "docs" / name))
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
