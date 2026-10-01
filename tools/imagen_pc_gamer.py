from PIL import Image, ImageDraw, ImageFont, ImageFilter
S=2; W=1200*S
B="/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"; R="/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
f=lambda p,s: ImageFont.truetype(p,int(s*S)); s=lambda v:int(v*S)
img=Image.new("RGB",(W,W)); d=ImageDraw.Draw(img)
for y in range(W):
  t=y/W; d.line([(0,y),(W,y)],fill=(int(10+8*t),int(14+10*t),int(26+30*t)))
# brillo de fondo
glow=Image.new("L",(W,W),0); ImageDraw.Draw(glow).ellipse([s(-100),s(250),s(700),s(1150)],fill=140); glow=glow.filter(ImageFilter.GaussianBlur(s(120)))
img.paste((0,132,214),(0,0),glow)
glow2=Image.new("L",(W,W),0); ImageDraw.Draw(glow2).ellipse([s(150),s(500),s(650),s(1100)],fill=110); glow2=glow2.filter(ImageFilter.GaussianBlur(s(110)))
img.paste((255,64,129),(0,0),glow2)
d=ImageDraw.Draw(img)
# franja superior
d.rectangle([0,0,W,s(10)],fill=(0,132,214))
# título grande
d.text((s(60),s(70)),"PC GAMER",font=f(B,150),fill=(255,255,255))
# sello ARMADA
d.rounded_rectangle([s(64),s(250),s(560),s(350)],radius=s(18),fill=(250,204,21))
d.text((s(312),s(300)),"ARMADA ✓",font=f(B,70),fill=(17,17,17),anchor="mm") if False else d.text((s(312),s(300)),"ARMADA",font=f(B,72),fill=(17,17,17),anchor="mm")
d.text((s(590),s(300)),"Lista para usar · Nueva",font=f(R,38),fill=(203,213,225),anchor="lm")
# gabinete real (Sentey X10) sobre tarjeta
case=Image.open("/home/user/exe.com.ar/site/assets/img/products/outlet-sentey-x10.webp").convert("RGBA")
# quitar fondo blanco
px=case.load()
for yy in range(case.height):
  for xx in range(case.width):
    r,g,b,a=px[xx,yy]
    if r>215 and g>215 and b>215 and max(r,g,b)-min(r,g,b)<18: px[xx,yy]=(r,g,b,0)
case=case.crop(case.getbbox()); k=s(640)/case.height; case=case.resize((int(case.width*k),s(640)),Image.LANCZOS)
sh=Image.new("L",(W,W),0); ImageDraw.Draw(sh).ellipse([s(80),s(1030),s(560),s(1090)],fill=160); sh=sh.filter(ImageFilter.GaussianBlur(s(20)))
img.paste((0,0,0),(0,0),sh)
img.paste(case,(s(320)-case.width//2,s(420)),case)
# especificaciones
specs=[("CPU","AMD Ryzen 5 2600 PRO","6 núcleos / 12 hilos"),("RAM","16 GB DDR4","2 × 8 GB dual channel"),("SSD","120 GB","arranque rápido"),("MOTHER","A320","socket AM4"),("FUENTE","650 W","80 Plus Bronze"),("GABINETE","Sentey X10","iluminación RGB")]
y=s(420)
for lab,val,sub in specs:
  d.rounded_rectangle([s(640),y,s(1140),y+s(94)],radius=s(14),fill=(22,30,48),outline=(42,58,80),width=s(2))
  d.text((s(664),y+s(16)),lab,font=f(B,22),fill=(250,204,21))
  d.text((s(664),y+s(42)),val,font=f(B,34),fill=(255,255,255))
  d.text((s(1120),y+s(30)),sub,font=f(R,22),fill=(148,163,184),anchor="rs")
  y+=s(106)
# aviso placa de video y pie
d.text((s(640),y+s(6)),"Sin placa de video: sumale la que quieras.",font=f(R,26),fill=(203,213,225))
d.text((s(60),s(1140)),"EXE",font=f(B,44),fill=(0,132,214))
d.text((s(1140),s(1150)),"exe.com.ar",font=f(B,30),fill=(148,163,184),anchor="rm")
img.resize((1200,1200),Image.LANCZOS).save("site/assets/img/products/outlet-pc-gamer-ryzen5.webp","WEBP",quality=88,method=6)

