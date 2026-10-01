import json, math, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
S=2; W=1200*S
F="/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"; FR="/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
font=lambda p,s: ImageFont.truetype(p, s*S)
P=[ # id, cat, brand, title, sub
("outlet-aorus-p750w-nueva","psu","GIGABYTE AORUS","P750W","750W · 80 Plus Gold · Modular · Nueva"),
("outlet-aorus-p750w-usada","psu","GIGABYTE AORUS","P750W","750W · 80 Plus Gold · Modular · Usada"),
("outlet-gigabyte-p1000gm","psu","GIGABYTE","P1000GM","1000W · 80 Plus Gold · Modular"),
("outlet-gigabyte-p750gm","psu","GIGABYTE","P750GM","750W · 80 Plus Gold · Modular"),
("outlet-gigabyte-p850gm","psu","GIGABYTE","P850GM","850W · 80 Plus Gold · Modular"),
("outlet-thermaltake-smart-700w","psu","THERMALTAKE","Smart 700W","80 Plus White"),
("outlet-thermaltake-smart-rgb-700w","psu","THERMALTAKE","Smart RGB 700W","80 Plus · Ventilador RGB"),
("outlet-sentey-r20","case","SENTEY","R20 RGB","Gabinete con ventiladores RGB"),
("outlet-sentey-x10","case","SENTEY","X10 Rainbow","Gabinete con iluminación Rainbow"),
("outlet-biostar-z490a-silver","mb","BIOSTAR","RACING Z490A-SILVER","LGA1200 · Intel 10.ª / 11.ª gen"),
("outlet-gigabyte-b460m-ds3h-v2","mb","GIGABYTE","B460M DS3H V2","LGA1200 · Micro-ATX"),
("outlet-msi-h510m-a-pro","mb","MSI","H510M-A PRO","LGA1200 · Micro-ATX"),
("outlet-msi-mpg-z490-gaming-plus","mb","MSI","MPG Z490 GAMING PLUS","LGA1200 · ATX"),
("outlet-z390-aorus-elite","mb","GIGABYTE AORUS","Z390 AORUS ELITE","LGA1151 · Intel 8.ª / 9.ª gen"),
("outlet-pc-gamer-ryzen5","pc","EXE","PC Gamer Ryzen 5 2600","16 GB RAM · SSD 120 GB · Nueva"),
("outlet-steam-deck-512","deck","VALVE","Steam Deck 512GB","Consola portátil"),
("outlet-rtx3090-zotac-trinity","gpu","ZOTAC GAMING","RTX 3090 Trinity","24 GB GDDR6X"),
("outlet-celeron-g5905","cpu","INTEL","Celeron G5905","3.5 GHz · LGA1200 · 10.ª gen"),
("outlet-celeron-g5925-full","cpu","INTEL","Celeron G5925","3.6 GHz · LGA1200 · En caja"),
("outlet-celeron-g5925-sin-caja","cpu","INTEL","Celeron G5925","3.6 GHz · LGA1200 · Sin caja"),
("outlet-i3-10100","cpu","INTEL","Core i3-10100","4.3 GHz Turbo · LGA1200"),
("outlet-i3-10100f","cpu","INTEL","Core i3-10100F","4.3 GHz Turbo · LGA1200 · Sin gráficos"),
("outlet-i3-10105","cpu","INTEL","Core i3-10105","4.4 GHz Turbo · LGA1200"),
("outlet-i3-12100f","cpu","INTEL","Core i3-12100F","4.3 GHz Turbo · LGA1700 · Sin gráficos"),
("outlet-i5-10400","cpu","INTEL","Core i5-10400","4.3 GHz Turbo · LGA1200"),
("outlet-pentium-g5420","cpu","INTEL","Pentium Gold G5420","3.8 GHz · LGA1151"),
]
ACC={"INTEL":(0,113,197),"MSI":(220,38,38),"GIGABYTE":(234,88,12),"GIGABYTE AORUS":(234,88,12),"BIOSTAR":(14,165,233),"THERMALTAKE":(22,163,74),"SENTEY":(147,51,234),"ZOTAC GAMING":(234,179,8),"VALVE":(30,64,175),"EXE":(0,132,214)}
def s(v): return int(v*S)
def rr(d,box,r,**k): d.rounded_rectangle([s(x) for x in box],radius=s(r),**k)
def icon(d,img,cat,a):
  dark=(30,35,45); mid=(55,62,75); lite=(200,206,216)
  cx,cy=600,500
  if cat=="cpu":
    rr(d,(390,290,810,710),28,fill=(46,125,50) if False else (32,96,60))
    for i in range(14):
      x=410+i*28; d.rectangle([s(x),s(270),s(x+10),s(290)],fill=(212,175,55)); d.rectangle([s(x),s(710),s(x+10),s(730)],fill=(212,175,55))
      y=310+i*28; d.rectangle([s(370),s(y),s(390),s(y+10)],fill=(212,175,55)); d.rectangle([s(810),s(y),s(830),s(y+10)],fill=(212,175,55))
    rr(d,(450,350,750,650),16,fill=(196,200,208)); rr(d,(470,370,730,630),12,outline=(150,155,165),width=s(3))
    d.text((s(600),s(500)),"INTEL" if a=="INTEL" else a,font=font(F,46),fill=(70,76,88),anchor="mm")
  elif cat=="mb":
    rr(d,(330,250,870,750),18,fill=(28,32,40)); 
    rr(d,(420,330,580,490),10,fill=(160,165,175)); rr(d,(440,350,560,470),6,fill=(90,95,105))
    for i in range(4): rr(d,(640+i*34,300,664+i*34,560),5,fill=ACC.get(a,(0,132,214)) if i%2==0 else (70,76,88))
    for i in range(3): rr(d,(370,560+i*55,800,580+i*55),5,fill=(70,76,88) if i else (150,155,165))
    rr(d,(340,260,400,380),6,fill=(55,60,70)); rr(d,(720,620,840,720),10,fill=(48,54,64))
    for i in range(6): d.ellipse([s(360+i*12),s(700),s(368+i*12),s(708)],fill=(212,175,55))
  elif cat=="psu":
    rr(d,(340,300,860,700),22,fill=(30,34,42)); d.ellipse([s(430),s(330),s(770),s(670)],fill=(18,20,26))
    for r in range(40,170,26): d.ellipse([s(600-r),s(500-r),s(600+r),s(500+r)],outline=(80,86,98),width=s(5))
    for k in range(8):
      t=k*math.pi/4; d.line([s(600),s(500),s(600+165*math.cos(t)),s(500+165*math.sin(t))],fill=(80,86,98),width=s(5))
    d.ellipse([s(565),s(465),s(635),s(535)],fill=ACC.get(a,(0,132,214)))
  elif cat=="case":
    rr(d,(420,220,780,780),20,fill=(26,30,38)); rr(d,(445,250,755,750),12,fill=(48,56,72))
    cols=[(255,64,129),(0,200,255),(124,77,255)]
    for i,c in enumerate(cols):
      y=330+i*150; d.ellipse([s(520),s(y-60),s(680),s(y+100)],outline=c,width=s(10)); d.ellipse([s(570),s(y-10),s(630),s(y+50)],fill=(30,34,42))
  elif cat=="gpu":
    rr(d,(170,360,1030,640),26,fill=(30,34,42))
    for i in range(3):
      x=320+i*280; d.ellipse([s(x-115),s(500-115),s(x+115),s(500+115)],fill=(18,20,26))
      for k in range(9):
        t=k*2*math.pi/9; d.line([s(x),s(500),s(x+105*math.cos(t)),s(500+105*math.sin(t))],fill=(90,96,108),width=s(10))
      d.ellipse([s(x-30),s(470),s(x+30),s(530)],fill=ACC.get(a))
    d.rectangle([s(170),s(640),s(1030),s(660)],fill=(212,175,55))
  elif cat=="deck":
    rr(d,(170,340,1030,660),120,fill=(30,34,42)); rr(d,(390,375,810,625),14,fill=(10,12,16)); rr(d,(405,390,795,610),8,fill=(30,64,175))
    for x in (270,930): d.ellipse([s(x-45),s(420),s(x+45),s(510)],fill=(55,60,70))
    for (x,y) in ((930,560),(970,600),(890,600),(930,640)): d.ellipse([s(x-15),s(y-15-20),s(x+15),s(y+15-20)],fill=(80,86,98))
  elif cat=="pc":
    rr(d,(400,210,800,790),22,fill=(26,30,38)); rr(d,(430,240,770,760),12,fill=(20,26,38))
    rr(d,(470,300,730,380),8,fill=(0,132,214)); rr(d,(470,420,560,700),6,fill=(255,64,129)); rr(d,(590,420,730,520),8,fill=(70,76,88))
    d.ellipse([s(600),s(560),s(720),s(680)],outline=(0,200,255),width=s(8))
for pid,cat,brand,title,sub in P:
  a=ACC.get(brand,(0,132,214))
  img=Image.new("RGB",(W,W),(255,255,255)); d=ImageDraw.Draw(img)
  # fondo suave
  for y in range(W):
    t=y/W; c=int(250-14*t); d.line([(0,y),(W,y)],fill=(c,c,min(255,c+3)))
  # sombra del objeto
  sh=Image.new("L",(W,W),0); ImageDraw.Draw(sh).ellipse([s(260),s(760),s(940),s(830)],fill=90); sh=sh.filter(ImageFilter.GaussianBlur(s(25)))
  img.paste((150,155,165),(0,0),sh)
  icon(d,img,cat,brand)
  d.rectangle([0,0,W,s(14)],fill=a)
  d.text((s(70),s(70)),brand,font=font(F,46),fill=a)
  tf=font(F,72) if len(title)<18 else font(F,56)
  d.text((s(600),s(900)),title,font=tf,fill=(25,30,40),anchor="mm")
  d.text((s(600),s(985)),sub,font=font(FR,36),fill=(90,98,112),anchor="mm")
  rr(d,(70,1090,470,1140),25,fill=(236,239,244)); d.text((s(270),s(1115)),"Imagen ilustrativa",font=font(F,26),fill=(90,98,112),anchor="mm")
  d.text((s(1130),s(1115)),"EXE OUTLET",font=font(F,28),fill=(160,166,178),anchor="rm")
  img.resize((1200,1200),Image.LANCZOS).save(f"site/assets/img/products/muestra/{pid}.webp","WEBP",quality=86,method=6)
print("ok",len(P))
