"""
Objetos del evento modelados a medida real (metros) a partir de las referencias en
C:/Users/USER/Downloads/Digitalizar3d. Los artes de marca se recortan de esas imágenes.

Ejecutar:
  blender --background --factory-startup --python blender/objetos_evento.py
Genera:
  public/models/obj_<id>.glb      (uno por objeto, origen en el piso, frente hacia -Y en Blender)
  blender/texturas/*.jpg          (recortes usados como texturas)
  blender/objetos_evento.blend    (todos los objetos)
  blender/objetos_preview.png     (render de verificación)

Convención: X = ancho, Y = fondo (frente en -Y), Z = alto. En three.js el frente queda hacia +Z.
"""
import bpy, bmesh, math, os
import numpy as np
from mathutils import Vector, Matrix

AQUI = os.path.dirname(os.path.abspath(__file__))
REF = r"C:\Users\USER\Downloads\Digitalizar3d"
DEST = os.path.normpath(os.path.join(AQUI, "..", "public", "models"))
TEX = os.path.join(AQUI, "texturas")
os.makedirs(DEST, exist_ok=True); os.makedirs(TEX, exist_ok=True)

# ------------------------------------------------------------------ recortes
RECORTES = {   # nombre: (archivo, x0, y0, x1, y1) en píxeles, origen arriba-izquierda
    "smirnoff":         ("Barricada Smirnoff con medidas técnicas.png", 222, 180, 1250, 580),
    "veolia":           ("Cabina portátil amarilla Veolia.png", 525, 295, 803, 457),
    "artistas_banner":  ("Carpa de artistas Vueltabajero iluminada.png", 95, 282, 1145, 452),
    "artistas_fondo":   ("Carpa de artistas Vueltabajero iluminada.png", 472, 545, 797, 730),
    "planta_aviso":     ("Planta eléctrica industrial iluminada.png", 118, 100, 1012, 378),
    "gustico_aviso":    ("Puesto nocturno El GUSTICO.png", 130, 148, 1158, 412),
    "gustico_barra":    ("Puesto nocturno El GUSTICO.png", 140, 718, 1162, 1000),
    "burger_aviso":     ("Stand Distrit Burger Bar iluminado.png", 70, 152, 1092, 378),
    "burger_barra":     ("Stand Distrit Burger Bar iluminado.png", 180, 750, 1052, 1022),
    "burger_pantallas": ("Stand Distrit Burger Bar iluminado.png", 566, 432, 1008, 574),
    "vuelta_barra":     ("Stand Vueltabajero de Salsa Tropical.png", 150, 680, 1316, 922),
    "vuelta_logo":      ("Stand Vueltabajero de Salsa Tropical.png", 552, 104, 975, 244),
}

def recortar(nombre):
    archivo, x0, y0, x1, y1 = RECORTES[nombre]
    src = bpy.data.images.load(os.path.join(REF, archivo), check_existing=True)
    w, h = src.size
    px = np.empty(w * h * 4, dtype=np.float32); src.pixels.foreach_get(px)
    arr = px.reshape(h, w, 4)[h - y1:h - y0, x0:x1, :].copy()
    arr[..., 3] = 1.0
    img = bpy.data.images.new(nombre, x1 - x0, y1 - y0)
    img.pixels.foreach_set(arr.ravel())
    ruta = os.path.join(TEX, nombre + ".jpg")
    img.filepath_raw = ruta; img.file_format = 'JPEG'; img.save()
    img = bpy.data.images.load(ruta, check_existing=True)
    return img

# ------------------------------------------------------------------ materiales
_mats = {}
def mat(nombre, color=(1, 1, 1), metal=0.0, rough=0.6, emit=None, emit_fuerza=0.0, alpha=1.0, imagen=None):
    if nombre in _mats: return _mats[nombre]
    m = bpy.data.materials.new(nombre); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = emit_fuerza
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        for attr, val in (("surface_render_method", 'BLENDED'), ("blend_method", 'BLEND')):
            try: setattr(m, attr, val)
            except Exception: pass
    if imagen is not None:
        t = m.node_tree.nodes.new("ShaderNodeTexImage"); t.image = imagen
        m.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"])
    _mats[nombre] = m
    return m

def M():  # paleta común
    return dict(
        blanco_pl=mat("Plastico_blanco", (0.92, 0.92, 0.9), 0, 0.35),
        aluminio=mat("Aluminio", (0.8, 0.82, 0.84), 1, 0.3),
        acero=mat("Acero_inox", (0.75, 0.76, 0.77), 1, 0.22),
        negro=mat("Negro_mate", (0.03, 0.03, 0.035), 0.2, 0.6),
        gris_osc=mat("Gris_oscuro", (0.12, 0.12, 0.13), 0.3, 0.5),
        lona=mat("Lona_blanca", (0.93, 0.93, 0.9), 0, 0.9),
        crema=mat("Pared_crema", (0.95, 0.9, 0.78), 0, 0.85),
        foco=mat("Bombillo", (1, 0.85, 0.55), 0, 0.4, emit=(1, 0.78, 0.45), emit_fuerza=6),
        verde=mat("Verde_marca", (0.05, 0.32, 0.12), 0, 0.7),
        grama=mat("Grama", (0.12, 0.35, 0.12), 0, 0.95),
        hoja=mat("Hoja_planta", (0.13, 0.42, 0.12), 0, 0.7),
        vidrio=mat("Vidrio", (0.75, 0.88, 0.95), 0, 0.05, alpha=0.3),
        amarillo=mat("Amarillo", (0.95, 0.68, 0.02), 0, 0.45),
    )

# ------------------------------------------------------------------ geometría
def nuevo_obj(nombre, bm, material, col, suave=False):
    me = bpy.data.meshes.new(nombre); bm.to_mesh(me); bm.free()
    if suave:
        for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(nombre, me); ob.data.materials.append(material)
    col.objects.link(ob); return ob

def caja(col, nombre, material, sx, sy, sz, x=0, y=0, z=0, rot=(0, 0, 0), bisel=0.0):
    """Caja de tamaño (sx, sy, sz) con la base en z."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Diagonal((sx, sy, sz, 1)))
    ob = nuevo_obj(nombre, bm, material, col)
    ob.location = (x, y, z + sz / 2); ob.rotation_euler = rot
    if bisel:
        md = ob.modifiers.new("bisel", 'BEVEL'); md.width = bisel; md.segments = 2
        md.limit_method = 'ANGLE'
    return ob

def tubo(col, nombre, material, p1, p2, r, seg=12):
    p1, p2 = Vector(p1), Vector(p2); d = p2 - p1
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=d.length,
                          matrix=Matrix.Translation((p1 + p2) / 2) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4())
    return nuevo_obj(nombre, bm, material, col, suave=True)

def cilindro(col, nombre, material, r, h, x=0, y=0, z=0, seg=16, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2,
                          depth=h, matrix=Matrix.Translation((x, y, z + h / 2)))
    return nuevo_obj(nombre, bm, material, col, suave=True)

def esfera(col, nombre, material, r, x, y, z):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=r, matrix=Matrix.Translation((x, y, z)))
    return nuevo_obj(nombre, bm, material, col, suave=True)

def plano(col, nombre, material, w, h, x, y, z, orient='-Y'):
    """Plano con UV 0..1. orient: hacia dónde mira la cara ('-Y','+Y','-X','+X','+Z')."""
    bm = bmesh.new(); uv = bm.loops.layers.uv.new()
    if orient == '+Z':
        co = [(-w/2, -h/2, 0), (w/2, -h/2, 0), (w/2, h/2, 0), (-w/2, h/2, 0)]
    else:
        co = [(-w/2, 0, -h/2), (w/2, 0, -h/2), (w/2, 0, h/2), (-w/2, 0, h/2)]
    vs = [bm.verts.new(c) for c in co]
    f = bm.faces.new(vs)
    for l, (u, v) in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]): l[uv].uv = (u, v)
    ob = nuevo_obj(nombre, bm, material, col)
    rz = {'-Y': 0, '+Y': math.pi, '-X': -math.pi/2, '+X': math.pi/2, '+Z': 0}[orient]
    ob.rotation_euler = (0, 0, rz); ob.location = (x, y, z)
    return ob

def techo_carpa(col, nombre, material, W, L, z0, z1):
    """Techo piramidal (o a cuatro aguas si es rectangular)."""
    bm = bmesh.new()
    A, B = bm.verts.new((-W/2, -L/2, z0)), bm.verts.new((W/2, -L/2, z0))
    C, D = bm.verts.new((W/2, L/2, z0)), bm.verts.new((-W/2, L/2, z0))
    rh = max(0, (W - L) / 2)
    if rh > 0.05:
        R1, R2 = bm.verts.new((-rh, 0, z1)), bm.verts.new((rh, 0, z1))
        for f in ((A, B, R2, R1), (C, D, R1, R2), (B, C, R2), (D, A, R1)): bm.faces.new(f)
    else:
        R = bm.verts.new((0, 0, z1))
        for f in ((A, B, R), (B, C, R), (C, D, R), (D, A, R)): bm.faces.new(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return nuevo_obj(nombre, bm, material, col)

def tira_focos(col, pref, mt, x0, x1, y, z, n):
    for i in range(n):
        esfera(col, f"{pref}_foco{i}", mt, 0.035, x0 + (x1 - x0) * i / max(1, n - 1), y, z)

def planta_maceta(col, pref, m, x, y, alto=1.2):
    caja(col, pref + "_maceta", m["negro"], 0.32, 0.32, 0.55, x, y, 0)
    for i in range(6):
        a = i * math.pi / 3
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.12, radius2=0.0, depth=alto - 0.5,
                              matrix=Matrix.Translation((x + 0.08 * math.cos(a), y + 0.08 * math.sin(a), 0.55 + (alto - 0.5) / 2))
                              @ Matrix.Rotation(0.35, 4, Vector((-math.sin(a), math.cos(a), 0))))
        nuevo_obj(f"{pref}_hoja{i}", bm, m["hoja"], col)

# ------------------------------------------------------------------ objetos
def mesa(col, m):
    W, D, H, t = 0.67, 0.54, 0.42, 0.04
    caja(col, "mesa_tablero", m["blanco_pl"], W, D, t, 0, 0, H - t, bisel=0.012)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cilindro(col, f"mesa_pata{sx}{sy}", m["blanco_pl"], 0.03, H - t, sx * (W/2 - 0.07), sy * (D/2 - 0.07), 0, seg=4, r2=0.04)

def silla(col, m):
    W, D, H, hs = 0.53, 0.57, 0.87, 0.44
    caja(col, "silla_asiento", m["blanco_pl"], 0.46, 0.44, 0.035, 0, -0.03, hs - 0.035, bisel=0.012)
    for sx in (-1, 1):
        tubo(col, f"silla_pata_del{sx}", m["blanco_pl"], (sx * 0.2, -0.24, hs - 0.03), (sx * (W/2 - 0.022), -(D/2 - 0.022), 0), 0.022, 6)
        tubo(col, f"silla_pata_tra{sx}", m["blanco_pl"], (sx * 0.2, 0.16, hs - 0.03), (sx * (W/2 - 0.05), D/2 - 0.03, 0), 0.022, 6)
        tubo(col, f"silla_respaldo_lat{sx}", m["blanco_pl"], (sx * 0.21, 0.18, hs), (sx * 0.19, 0.25, H - 0.04), 0.022, 8)
    tubo(col, "silla_respaldo_sup", m["blanco_pl"], (-0.2, 0.25, H - 0.035), (0.2, 0.25, H - 0.035), 0.03, 8)
    for i in range(5):
        x = -0.12 + i * 0.06
        tubo(col, f"silla_listón{i}", m["blanco_pl"], (x, 0.185, hs + 0.02), (x, 0.245, H - 0.06), 0.012, 6)

def bano(col, m):
    W, D, H = 1.05, 1.05, 2.20
    amarillo = mat("Bano_amarillo", (0.93, 0.68, 0.02), 0, 0.4)
    techo = mat("Bano_techo", (0.85, 0.87, 0.88), 0, 0.3, alpha=0.85)
    for sx in (-1, 1):
        for sy in (-1, 1):
            caja(col, f"bano_pata{sx}{sy}", m["gris_osc"], 0.14, 0.14, 0.1, sx * (W/2 - 0.07), sy * (D/2 - 0.07), 0)
    caja(col, "bano_cuerpo", amarillo, W, D, 1.80, 0, 0, 0.1, bisel=0.02)
    for sx in (-1, 1):
        for sy in (-1, 1):
            caja(col, f"bano_esquinero{sx}{sy}", m["gris_osc"], 0.04, 0.04, 1.80, sx * (W/2), sy * (D/2), 0.1)
    caja(col, "bano_puerta", mat("Bano_puerta", (0.98, 0.74, 0.05), 0, 0.35), 0.78, 0.03, 1.66, 0.04, -D/2 - 0.01, 0.16, bisel=0.01)
    caja(col, "bano_manija", m["negro"], 0.07, 0.04, 0.12, 0.33, -D/2 - 0.035, 1.0)
    plano(col, "bano_aviso", mat("Aviso_veolia", imagen=recortar("veolia"), rough=0.5), 0.36, 0.21, 0.08, -D/2 - 0.03, 1.52)
    caja(col, "bano_cornisa", mat("Bano_cornisa", (0.8, 0.8, 0.8), 0, 0.4), W + 0.03, D + 0.03, 0.06, 0, 0, 1.90)
    bm = bmesh.new()   # domo semicilíndrico
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=W/2, radius2=W/2, depth=D,
                          matrix=Matrix.Translation((0, 0, 1.96)) @ Matrix.Rotation(math.pi/2, 4, 'X') @ Matrix.Diagonal((1, 0.24 / (W/2) * 1, 1, 1)))
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.001], context='VERTS')
    nuevo_obj("bano_domo", bm, techo, col, suave=True)
    for i in range(3):
        caja(col, f"bano_rejilla{i}", m["gris_osc"], 0.012, 0.3, 0.02, -W/2 - 0.005, -0.1, 1.72 + i * 0.05)

def planta_electrica(col, m):
    S, H = 2.0, 2.0
    piso = mat("Lamina_alfajor", (0.32, 0.33, 0.34), 0.8, 0.45)
    caja(col, "planta_piso", piso, S, S, 0.06, 0, 0, 0)
    for sx in (-1, 1):   # borde de seguridad
        caja(col, f"planta_borde_x{sx}", m["amarillo"], S, 0.06, 0.08, 0, sx * (S/2 - 0.03), 0)
        caja(col, f"planta_borde_y{sx}", m["amarillo"], 0.06, S, 0.08, sx * (S/2 - 0.03), 0, 0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            caja(col, f"planta_poste{sx}{sy}", m["negro"], 0.08, 0.08, H, sx * (S/2 - 0.04), sy * (S/2 - 0.04), 0)
    caja(col, "planta_techo", m["gris_osc"], S, S, 0.05, 0, 0, H - 0.05)
    aviso = mat("Aviso_planta", imagen=recortar("planta_aviso"), rough=0.5)
    for sx in (-1, 1):
        caja(col, f"planta_franja_x{sx}", m["negro"], S, 0.04, 0.42, 0, sx * S/2, H - 0.42)
        caja(col, f"planta_franja_y{sx}", m["negro"], 0.04, S, 0.42, sx * S/2, 0, H - 0.42)
    plano(col, "planta_aviso_frente", aviso, S, 0.42, 0, -S/2 - 0.025, H - 0.21, '-Y')
    plano(col, "planta_aviso_lado", aviso, S, 0.42, S/2 + 0.025, 0, H - 0.21, '+X')
    plano(col, "planta_aviso_atras", aviso, S, 0.42, 0, S/2 + 0.025, H - 0.21, '+Y')
    plano(col, "planta_aviso_izq", aviso, S, 0.42, -S/2 - 0.025, 0, H - 0.21, '-X')
    malla = mat("Malla_jaula", (0.2, 0.21, 0.22), 0.6, 0.5, alpha=0.45)
    for nombre, w, x, y, o in (("izq", S - 0.1, -S/2 + 0.02, 0, '-X'), ("der", S - 0.1, S/2 - 0.02, 0, '+X'), ("atras", S - 0.1, 0, S/2 - 0.02, '+Y')):
        plano(col, "planta_malla_" + nombre, malla, w, 1.0, x, y, 0.65, o)
    # generador
    caja(col, "gen_chasis", m["negro"], 1.45, 0.78, 0.22, 0, 0.05, 0.06)
    caja(col, "gen_cuerpo", mat("Generador_amarillo", (0.95, 0.66, 0.02), 0.1, 0.45), 1.45, 0.78, 0.72, 0, 0.05, 0.28, bisel=0.015)
    caja(col, "gen_panel", m["negro"], 0.3, 0.02, 0.24, 0.35, -0.35, 0.62)
    caja(col, "gen_pantalla", mat("Pantalla_azul", (0.1, 0.4, 0.9), 0, 0.2, emit=(0.2, 0.5, 1), emit_fuerza=3), 0.12, 0.022, 0.07, 0.3, -0.352, 0.74)
    for i in range(6):
        caja(col, f"gen_rejilla{i}", m["gris_osc"], 0.34, 0.02, 0.022, -0.5, -0.352, 0.55 + i * 0.05)
    cilindro(col, "extintor", mat("Rojo_extintor", (0.75, 0.03, 0.03), 0.2, 0.35), 0.075, 0.5, S/2 - 0.2, -S/2 + 0.2, 0.55)
    for sx in (-0.5, 0.5):
        caja(col, f"planta_reflector{sx}", m["gris_osc"], 0.35, 0.12, 0.2, sx, -S/2 + 0.1, H + 0.02)
        plano(col, f"planta_reflector_luz{sx}", m["foco"], 0.3, 0.15, sx, -S/2 + 0.035, H + 0.12, '-Y')

def stand_comida(col, m, pref, W, D, H, aviso, barra, poste, pared, extra):
    """Stand de comida cuadrado: barra al frente y a los lados, aviso superior, techo."""
    hb, ha = 1.05, 0.7          # alto de la barra y del aviso superior
    for sx in (-1, 1):
        for sy in (-1, 1):
            caja(col, f"{pref}_poste{sx}{sy}", poste, 0.07, 0.07, H, sx * (W/2 - 0.035), sy * (D/2 - 0.035), 0)
    caja(col, f"{pref}_piso", m["gris_osc"], W, D, 0.04, 0, 0, 0)
    caja(col, f"{pref}_techo", m["lona"], W, D, 0.04, 0, 0, H - 0.04)
    # aviso superior en las 4 caras
    for nombre, x, y, o, w in (("f", 0, -D/2 - 0.04, '-Y', W), ("d", W/2 + 0.04, 0, '+X', D), ("i", -W/2 - 0.04, 0, '-X', D), ("a", 0, D/2 + 0.04, '+Y', W)):
        plano(col, f"{pref}_aviso_{nombre}", aviso, w + 0.08, ha, x, y, H - ha / 2, o)
    caja(col, f"{pref}_aviso_caja", pared, W + 0.06, D + 0.06, ha - 0.02, 0, 0, H - ha + 0.01)
    # barra frontal y laterales (mitad delantera)
    caja(col, f"{pref}_barra_f", pared, W - 0.1, 0.5, hb, 0, -D/2 + 0.3, 0)
    plano(col, f"{pref}_barra_f_arte", barra, W - 0.1, hb - 0.08, 0, -D/2 + 0.045, hb / 2, '-Y')
    for sx in (-1, 1):
        caja(col, f"{pref}_barra_l{sx}", pared, 0.06, D * 0.55, hb, sx * (W/2 - 0.08), -D/2 + D * 0.275 + 0.05, 0)
        plano(col, f"{pref}_barra_l{sx}_arte", barra, D * 0.55, hb - 0.08, sx * (W/2 - 0.045), -D/2 + D * 0.275 + 0.05, hb / 2,
              '+X' if sx > 0 else '-X')
    caja(col, f"{pref}_meson", m["acero"], W - 0.06, 0.6, 0.04, 0, -D/2 + 0.3, hb)
    # pared de fondo y equipos
    caja(col, f"{pref}_fondo", m["crema"], W - 0.1, 0.05, H - ha, 0, D/2 - 0.08, 0)
    caja(col, f"{pref}_nevera", m["acero"], 1.1, 0.7, 1.9, W/2 - 0.75, D/2 - 0.5, 0, bisel=0.01)
    caja(col, f"{pref}_mesa_trabajo", m["acero"], 1.6, 0.65, 0.9, -W/2 + 1.0, D/2 - 0.5, 0)
    tira_focos(col, pref, m["foco"], -W/2 + 0.2, W/2 - 0.2, -D/2 + 0.05, H - ha - 0.12, 10)
    extra()

def gustico(col, m):
    W = D = 4.0; H = 2.8
    stand_comida(col, m, "gustico", W, D, H,
                 mat("Aviso_gustico", imagen=recortar("gustico_aviso"), rough=0.5),
                 mat("Barra_gustico", imagen=recortar("gustico_barra"), rough=0.5),
                 m["aluminio"], mat("Pared_blanca", (0.95, 0.95, 0.94), 0, 0.7),
                 lambda: (caja(col, "gustico_plancha", m["negro"], 1.0, 0.5, 0.06, -1.0, -D/2 + 0.75, 1.09),
                          caja(col, "gustico_freidora", m["acero"], 0.8, 0.5, 0.95, 1.0, 0.4, 0),
                          caja(col, "gustico_canastas", mat("Canasta_azul", (0.1, 0.3, 0.75), 0, 0.6), 0.6, 0.4, 0.8, -1.4, 0.9, 0)))

def burger(col, m):
    W = D = 4.0; H = 2.8
    def extra():
        caja(col, "burger_campana", m["acero"], 1.5, 0.9, 0.5, -1.0, 0.9, H - 1.25)
        caja(col, "burger_plancha", m["negro"], 1.3, 0.6, 0.9, -1.0, 0.9, 0)
        plano(col, "burger_pantallas", mat("Pantallas_burger", imagen=recortar("burger_pantallas"), rough=0.3,
              emit=(1, 1, 1), emit_fuerza=0.0), 1.9, 0.6, 0.6, D/2 - 0.11, 1.95, '-Y')
        caja(col, "burger_vitrina", m["vidrio"], 0.65, 0.45, 0.6, 1.4, -D/2 + 0.32, 1.09)
        planta_maceta(col, "burger_pl1", m, -W/2 + 0.22, -D/2 - 0.2 + 0.4, 1.4)
        planta_maceta(col, "burger_pl2", m, W/2 - 0.22, -D/2 - 0.2 + 0.4, 1.4)
        for i in range(5):
            x = -1.5 + i * 0.75
            tubo(col, f"burger_cable{i}", m["negro"], (x, -0.6, H - 0.7), (x, -0.6, H - 1.05), 0.006, 4)
            esfera(col, f"burger_bombillo{i}", m["foco"], 0.06, x, -0.6, H - 1.1)
    stand_comida(col, m, "burger", W, D, H,
                 mat("Aviso_burger", imagen=recortar("burger_aviso"), rough=0.5),
                 mat("Barra_burger", imagen=recortar("burger_barra"), rough=0.5),
                 m["negro"], mat("Pared_burger", (0.96, 0.92, 0.8), 0, 0.7), extra)

def carpa_popup(col, m, pref, W, D, H, cenefa):
    """Carpa plegable (pop-up): patas, techo piramidal y cenefa de 25 cm."""
    for sx in (-1, 1):
        for sy in (-1, 1):
            caja(col, f"{pref}_pata{sx}{sy}", m["gris_osc"], 0.04, 0.04, H, sx * (W/2 - 0.02), sy * (D/2 - 0.02), 0)
    techo_carpa(col, f"{pref}_techo", m["lona"], W + 0.06, D + 0.06, H, H + min(W, D) * 0.35)
    for nombre, x, y, o, w in (("f", 0, -D/2 - 0.03, '-Y', W), ("d", W/2 + 0.03, 0, '+X', D), ("i", -W/2 - 0.03, 0, '-X', D), ("a", 0, D/2 + 0.03, '+Y', W)):
        plano(col, f"{pref}_cenefa_{nombre}", cenefa, w + 0.06, 0.25, x, y, H - 0.125, o)

def bar_vueltabajero(col, m):
    W, D, H = 3.0, 2.0, 2.5
    carpa_popup(col, m, "vbar", W, D, H, m["verde"])
    # logo en la caída frontal del techo
    z0, z1 = H, H + min(W, D) * 0.35
    run = D / 2 + 0.03; th = math.atan2(z1 - z0, run)
    lg = plano(col, "vbar_logo_techo", mat("Logo_vuelta", imagen=recortar("vuelta_logo"), rough=0.6), 1.0, 0.33, 0, 0, 0, '-Y')
    lg.rotation_euler = (-(math.pi / 2 - th), 0, 0)
    lg.location = (0, -run * 0.55 - 0.01, z0 + (z1 - z0) * 0.45 + 0.01)
    arte = mat("Barra_vuelta", imagen=recortar("vuelta_barra"), rough=0.5)
    caja(col, "vbar_barra", m["verde"], W - 0.1, 0.45, 1.0, 0, -D/2 + 0.25, 0)
    plano(col, "vbar_barra_arte", arte, W - 0.1, 0.92, 0, -D/2 + 0.02, 0.5, '-Y')
    for sx in (-1, 1):
        caja(col, f"vbar_lado{sx}", m["verde"], 0.05, D - 0.5, 1.0, sx * (W/2 - 0.06), 0.2, 0)
    caja(col, "vbar_meson", m["acero"], W - 0.06, 0.5, 0.04, 0, -D/2 + 0.25, 1.0)
    caja(col, "vbar_fondo", m["verde"], W - 0.1, 0.04, 2.3, 0, D/2 - 0.05, 0)
    nevera_vidrio = mat("Nevera_luz", (0.85, 0.9, 1), 0, 0.1, emit=(0.8, 0.88, 1), emit_fuerza=1.5)
    for sx in (-1, 1):
        caja(col, f"vbar_nevera{sx}", m["negro"], 0.65, 0.6, 1.85, sx * 0.95, D/2 - 0.4, 0)
        plano(col, f"vbar_nevera{sx}_vidrio", nevera_vidrio, 0.52, 1.4, sx * 0.95, D/2 - 0.705, 1.0, '-Y')
    caja(col, "vbar_estante", m["negro"], 1.1, 0.3, 0.04, 0, D/2 - 0.25, 1.45)
    colores = [(0.55, 0.25, 0.05), (0.15, 0.35, 0.1), (0.75, 0.55, 0.15), (0.4, 0.1, 0.05)]
    for i in range(9):
        cilindro(col, f"vbar_botella{i}", mat(f"Botella{i % 4}", colores[i % 4], 0, 0.15), 0.035, 0.3, -0.45 + i * 0.11, D/2 - 0.25, 1.49, seg=8)
    tira_focos(col, "vbar", m["foco"], -W/2 + 0.1, W/2 - 0.1, -D/2 + 0.05, H - 0.32, 8)

def carpa_artistas(col, m):
    W = D = 3.0; H = 2.8
    banner = mat("Banner_artistas", imagen=recortar("artistas_banner"), rough=0.6)
    carpa_popup(col, m, "art", W, D, H, banner)
    caja(col, "art_grama", m["grama"], W - 0.1, D - 0.1, 0.02, 0, 0, 0)
    for sx in (-1, 1):   # paredes laterales y fondo
        caja(col, f"art_pared{sx}", m["lona"], 0.02, D, H - 0.25, sx * (W/2 - 0.01), 0, 0)
    caja(col, "art_pared_fondo", m["lona"], W, 0.02, H - 0.25, 0, D/2 - 0.01, 0)
    plano(col, "art_banner_fondo", mat("Banner_fondo", imagen=recortar("artistas_fondo"), rough=0.6), 1.3, 0.75, 0, D/2 - 0.03, 1.75, '-Y')
    cortina = mat("Cortina_verde", (0.04, 0.3, 0.1), 0, 0.8)
    for sx in (-1, 1):
        cilindro(col, f"art_cortina{sx}", cortina, 0.14, H - 0.25, sx * (W/2 - 0.12), -D/2 + 0.08, 0, seg=10, r2=0.09)
    # sala
    cuero = mat("Cuero_negro", (0.02, 0.02, 0.02), 0.1, 0.35)
    caja(col, "art_sofa_base", cuero, 1.8, 0.8, 0.42, 0, D/2 - 0.55, 0, bisel=0.03)
    caja(col, "art_sofa_resp", cuero, 1.8, 0.2, 0.42, 0, D/2 - 0.25, 0.42, bisel=0.03)
    for sx in (-1, 1): caja(col, f"art_sofa_brazo{sx}", cuero, 0.18, 0.8, 0.62, sx * 0.9, D/2 - 0.55, 0, bisel=0.03)
    caja(col, "art_mesa_centro", m["negro"], 1.0, 0.5, 0.42, 0, 0.0, 0)
    caja(col, "art_tapete", mat("Tapete", (0.75, 0.65, 0.45), 0, 0.95), 1.6, 1.1, 0.01, 0, 0.05, 0.02)
    caja(col, "art_tocador", m["negro"], 0.9, 0.5, 0.75, -W/2 + 0.55, -0.2, 0)
    caja(col, "art_espejo", m["negro"], 0.8, 0.04, 0.8, -W/2 + 0.55, 0.0, 0.9)
    plano(col, "art_espejo_luna", mat("Espejo", (0.6, 0.65, 0.7), 1, 0.05), 0.65, 0.65, -W/2 + 0.55, -0.025, 1.3, '-Y')
    for i in range(5):
        esfera(col, f"art_espejo_luz{i}", m["foco"], 0.03, -W/2 + 0.2 + i * 0.175, -0.03, 1.68)
    caja(col, "art_nevera", m["negro"], 0.5, 0.5, 0.9, W/2 - 0.35, 0.3, 0)
    plano(col, "art_nevera_vidrio", mat("Nevera_luz", (0.85, 0.9, 1)), 0.4, 0.7, W/2 - 0.35, 0.045, 0.48, '-Y')
    caja(col, "art_aire", m["blanco_pl"], 0.8, 0.22, 0.28, W/2 - 0.5, D/2 - 0.15, 2.1)
    planta_maceta(col, "art_planta", m, W/2 - 0.35, D/2 - 0.35, 1.5)
    tira_focos(col, "art", m["foco"], -W/2 + 0.2, W/2 - 0.2, -D/2 + 0.3, H - 0.32, 8)

def barricada(col, m):
    """Barricada de 2,00 × 1,10 × 0,60 m. Origen en el extremo izquierdo (para encadenar)."""
    rojo = mat("Rojo_barricada", (0.38, 0.02, 0.04), 0.4, 0.4)
    r = 0.02; xa, xb = 0.06, 1.86
    for x in (xa, xb):
        tubo(col, f"barr_poste{x}", rojo, (x, 0, 0.04), (x, 0, 1.08), r)
        tubo(col, f"barr_pie{x}", rojo, (x, -0.3, 0.025), (x, 0.3, 0.025), r)
    tubo(col, "barr_sup", rojo, (xa - r, 0, 1.08), (xb + r, 0, 1.08), r)
    tubo(col, "barr_inf", rojo, (xa, 0, 0.3), (xb, 0, 0.3), r)
    for z in (0.32, 1.0):
        tubo(col, f"barr_gancho{z}", rojo, (xb, 0, z), (2.0, 0, z), 0.008)
    arte = mat("Arte_smirnoff", imagen=recortar("smirnoff"), rough=0.5)
    plano(col, "barr_arte_frente", arte, xb - xa - 0.1, 0.68, (xa + xb) / 2, -0.012, 0.67, '-Y')
    plano(col, "barr_arte_atras", arte, xb - xa - 0.1, 0.68, (xa + xb) / 2, 0.012, 0.67, '+Y')

OBJETOS = {
    "mesa": mesa, "silla": silla, "bano": bano, "planta": planta_electrica,
    "gustico": gustico, "burger": burger, "bar_vueltabajero": bar_vueltabajero,
    "carpa_artistas": carpa_artistas, "barricada": barricada,
}

# ------------------------------------------------------------------ principal
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    m = M()
    cols = {}
    for oid, fn in OBJETOS.items():
        col = bpy.data.collections.new(oid); sc.collection.children.link(col)
        fn(col, m); cols[oid] = col
    bpy.context.view_layer.update()

    resumen = {}
    for oid, col in cols.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in col.objects: o.select_set(True)
        bpy.context.view_layer.objects.active = col.objects[0]
        bpy.ops.export_scene.gltf(filepath=os.path.join(DEST, f"obj_{oid}.glb"), export_format='GLB',
                                  use_selection=True, export_apply=True, export_yup=True,
                                  export_image_format='JPEG')
        mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
        for o in col.objects:
            for c in o.bound_box:
                w = o.matrix_world @ Vector(c); mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
        resumen[oid] = tuple(round(v, 2) for v in (mx - mn))
    print("MEDIDAS", resumen)

    # vitrina para verificar: todos en fila
    x = 0
    for oid, col in cols.items():
        ancho = resumen[oid][0]
        for o in col.objects: o.location.x += x + ancho / 2 - (1.0 if oid == "barricada" else 0)
        x += ancho + 0.8
    bpy.ops.mesh.primitive_plane_add(size=80, location=(x / 2, 0, 0))
    bpy.context.active_object.data.materials.append(mat("Piso_vitrina", (0.5, 0.5, 0.52), 0, 0.9))
    sol = bpy.data.objects.new("Sol", bpy.data.lights.new("Sol", 'SUN')); sc.collection.objects.link(sol)
    sol.data.energy = 3.5; sol.rotation_euler = (math.radians(55), 0, math.radians(-30))
    sc.world = bpy.data.worlds.new("Mundo"); sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.6, 0.68, 1)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam")); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = x + 1
    cam.location = (x / 2, -30, 14); cam.rotation_euler = (math.radians(66), 0, 0)
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try: sc.render.engine = eng; break
        except TypeError: pass
    sc.render.resolution_x, sc.render.resolution_y = 2400, 700
    sc.render.filepath = os.path.join(AQUI, "objetos_preview.png")
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(AQUI, "objetos_evento.blend"))
    print("OBJETOS OK")

main()
